using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using Gssg.Outlook;
using OfficeOutlook = global::Microsoft.Office.Interop.Outlook;

namespace Gssg.Outlook.Launcher
{
    [Serializable]
    internal sealed class NativeOutlookException : Exception
    {
        internal NativeOutlookException(string code, string message, Exception inner = null) : base(message, inner)
        {
            Code = code;
        }

        internal string Code { get; private set; }
    }

    internal sealed class MailboxInfo
    {
        internal string SmtpAddress { get; set; }
    }

    internal sealed class OpenMessageResult
    {
        internal string EntryId { get; set; }
        internal string StoreId { get; set; }
        internal string InternetMessageId { get; set; }
        internal IReadOnlyList<string> GNumbers { get; set; }
    }

    internal sealed class OutlookClient : IDisposable
    {
        private const string InternetMessageIdProperty = "http://schemas.microsoft.com/mapi/proptag/0x1035001F";
        private readonly OfficeOutlook.Application application;
        private readonly OfficeOutlook.NameSpace session;
        private bool disposed;

        internal OutlookClient()
        {
            try
            {
                application = new OfficeOutlook.Application();
                session = application.Session;
            }
            catch (COMException ex)
            {
                throw new NativeOutlookException(
                    "CLASSIC_OUTLOOK_REQUIRED",
                    "Classic Outlook is required. New Outlook alone cannot handle this action.", ex);
            }
        }

        internal MailboxInfo DiscoverActiveMailbox()
        {
            EnsureNotDisposed();
            try
            {
                var user = session.CurrentUser;
                var addressEntry = user == null ? null : user.AddressEntry;
                var address = addressEntry == null ? null : addressEntry.Address;
                if (addressEntry != null && string.Equals(addressEntry.Type, "EX", StringComparison.OrdinalIgnoreCase))
                {
                    var exchangeUser = addressEntry.GetExchangeUser();
                    if (exchangeUser != null && !string.IsNullOrWhiteSpace(exchangeUser.PrimarySmtpAddress))
                        address = exchangeUser.PrimarySmtpAddress;
                }
                if (string.IsNullOrWhiteSpace(address))
                    throw new NativeOutlookException("MAILBOX_NOT_FOUND", "No active Outlook mailbox was found.");
                return new MailboxInfo { SmtpAddress = address.Trim() };
            }
            catch (NativeOutlookException)
            {
                throw;
            }
            catch (COMException ex)
            {
                throw new NativeOutlookException("MAILBOX_NOT_FOUND", "No active Outlook mailbox was found.", ex);
            }
        }

        internal void CreateDraft(HandoffPayload payload, int handoffId, SentinelApiClient api)
        {
            EnsureNotDisposed();
            if (payload == null) throw new ArgumentNullException(nameof(payload));
            var staged = new List<string>();
            OfficeOutlook.MailItem mail = null;
            OfficeOutlook.Inspector inspector = null;
            var draftSaved = false;
            try
            {
                for (var index = 0; index < (payload.Attachments ?? new List<AttachmentRef>()).Count; index++)
                {
                    var attachment = payload.Attachments[index];
                    try
                    {
                        staged.Add(api.DownloadAttachment(handoffId, index, attachment.Filename));
                    }
                    catch (Exception ex)
                    {
                        throw new NativeOutlookException("ATTACHMENT_FAILURE", "An Outlook attachment could not be downloaded.", ex);
                    }
                }

                mail = (OfficeOutlook.MailItem)application.CreateItem(OfficeOutlook.OlItemType.olMailItem);
                inspector = mail.GetInspector;
                mail.Display(false);
                var signature = mail.HTMLBody;
                mail.HTMLBody = OutlookBody.Prepend(payload.BodyHtml, signature);
                mail.To = string.Join(";", payload.To ?? new List<string>());
                mail.CC = string.Join(";", payload.Cc ?? new List<string>());
                mail.Subject = payload.Subject ?? string.Empty;
                for (var index = 0; index < staged.Count; index++)
                    mail.Attachments.Add(staged[index], OfficeOutlook.OlAttachmentType.olByValue, Type.Missing, payload.Attachments[index].Filename);
                mail.Save();
                draftSaved = true;
            }
            catch (NativeOutlookException)
            {
                throw;
            }
            catch (COMException ex)
            {
                throw new NativeOutlookException("DRAFT_FAILURE", "Outlook could not create the draft.", ex);
            }
            finally
            {
                if (mail != null && inspector != null && !draftSaved)
                {
                    try { inspector.Close(OfficeOutlook.OlInspectorClose.olDiscard); }
                    catch (COMException) { }
                }
                foreach (var file in staged) DeleteStagedFile(file);
            }
        }

        internal OpenMessageResult OpenMessage(string entryId, string storeId, string internetMessageId)
        {
            EnsureNotDisposed();
            object item = null;
            try
            {
                if (!string.IsNullOrWhiteSpace(entryId) && !string.IsNullOrWhiteSpace(storeId))
                    item = session.GetItemFromID(entryId, storeId);
            }
            catch (COMException)
            {
                item = null;
            }
            if (item == null)
                item = FindInPairedStore(storeId, internetMessageId);
            if (item == null)
                throw new NativeOutlookException("MESSAGE_NOT_FOUND", "The Outlook message was not found in the paired mailbox.");

            try
            {
                dynamic openable = item;
                openable.Display(false);
                var refreshedEntryId = Convert.ToString(openable.EntryID);
                var parent = openable.Parent;
                var refreshedStoreId = Convert.ToString(parent.StoreID);
                var accessor = openable.PropertyAccessor;
                var refreshedMessageId = Convert.ToString(accessor.GetProperty(InternetMessageIdProperty));
                var text = (Convert.ToString(openable.Subject) ?? string.Empty) + "\n" + (Convert.ToString(openable.HTMLBody) ?? string.Empty);
                return new OpenMessageResult
                {
                    EntryId = refreshedEntryId,
                    StoreId = refreshedStoreId,
                    InternetMessageId = refreshedMessageId,
                    GNumbers = GNumberDetector.Detect(text)
                };
            }
            catch (COMException ex)
            {
                throw new NativeOutlookException("MESSAGE_NOT_FOUND", "The Outlook message could not be opened.", ex);
            }
        }
        private object FindInPairedStore(string storeId, string internetMessageId)
        {
            if (string.IsNullOrWhiteSpace(internetMessageId)) return null;
            foreach (OfficeOutlook.Store store in session.Stores)
            {
                if (!string.IsNullOrWhiteSpace(storeId) &&
                    !string.Equals(store.StoreID, storeId, StringComparison.Ordinal))
                    continue;
                var found = SearchFolder(store.GetRootFolder(), internetMessageId);
                if (found != null) return found;
            }
            return null;
        }

        private static object SearchFolder(OfficeOutlook.MAPIFolder folder, string internetMessageId)
        {
            try
            {
                foreach (object item in folder.Items)
                {
                    try
                    {
                        dynamic candidate = item;
                        var value = Convert.ToString(candidate.PropertyAccessor.GetProperty(InternetMessageIdProperty));
                        if (string.Equals(value, internetMessageId, StringComparison.OrdinalIgnoreCase)) return item;
                    }
                    catch (COMException) { }
                }
                foreach (OfficeOutlook.MAPIFolder child in folder.Folders)
                {
                    var found = SearchFolder(child, internetMessageId);
                    if (found != null) return found;
                }
            }
            catch (COMException) { }
            return null;
        }

        private static void DeleteStagedFile(string path)
        {
            try
            {
                if (File.Exists(path)) File.Delete(path);
                var directory = Path.GetDirectoryName(path);
                if (!string.IsNullOrWhiteSpace(directory) && Directory.Exists(directory) && Directory.GetFiles(directory).Length == 0)
                    Directory.Delete(directory);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        private void EnsureNotDisposed()
        {
            if (disposed) throw new ObjectDisposedException(nameof(OutlookClient));
        }

        public void Dispose()
        {
            disposed = true;
            // Do not quit Outlook: it may be the user's existing interactive instance.
        }
    }
}
