using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Office.Tools;
using Microsoft.Office.Tools.Outlook;
using Microsoft.Win32;
using OfficeOutlook = Microsoft.Office.Interop.Outlook;
using Gssg.Outlook;

namespace Gssg.Outlook.AddIn
{
    public sealed partial class ThisAddIn : OutlookAddInBase
    {
        private const string InternetMessageIdProperty = "http://schemas.microsoft.com/mapi/proptag/0x1035001F";
        private const string RegistryPath = "Software\\GSSG Manager\\Outlook Bridge";
        private const string OriginValue = "SentinelOrigin";
        private const string PaneTitleEnglish = "Employee context";
        private const string PaneTitleArabic = "سياق الموظف";

        private readonly Dictionary<OfficeOutlook.Explorer, ExplorerContext> explorerContexts =
            new Dictionary<OfficeOutlook.Explorer, ExplorerContext>();
        private readonly Dictionary<OfficeOutlook.Inspector, InspectorContext> inspectorContexts =
            new Dictionary<OfficeOutlook.Inspector, InspectorContext>();
        private SentinelApiClient api;
        private OfficeOutlook.Application outlookApplication;
        private bool disposed;

        protected override void OnStartupMain()
        {
            try
            {
                outlookApplication = Application;
                api = new SentinelApiClient(ReadSentinelOrigin(), new CredentialStore());
                ((OfficeOutlook.ExplorersEvents_Event)outlookApplication.Explorers).NewExplorer += Application_NewExplorer;
                ((OfficeOutlook.InspectorsEvents_Event)outlookApplication.Inspectors).NewInspector += Application_NewInspector;
                ((OfficeOutlook.ApplicationEvents_11_Event)outlookApplication).Quit += Application_Quit;
                foreach (OfficeOutlook.Explorer explorer in outlookApplication.Explorers)
                    AttachExplorer(explorer);
                foreach (OfficeOutlook.Inspector inspector in outlookApplication.Inspectors)
                    AttachInspector(inspector);
            }
            catch (Exception)
            {
                var arabic = IsArabic();
                var message = arabic
                    ? "تعذر تشغيل جسر GSSG Manager في Outlook.\r\nتحقق من إعدادات التثبيت وصحة Outlook الكلاسيكي."
                    : "GSSG Manager Outlook Bridge could not start.\r\nCheck the installation settings and classic Outlook.";
                var options = MessageBoxOptions.ServiceNotification;
                if (arabic) options |= MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign;
                MessageBox.Show(
                    message,
                    "GSSG Manager",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning,
                    MessageBoxDefaultButton.Button1,
                    options);
            }
            base.OnStartupMain();
        }

        private void Application_NewExplorer(OfficeOutlook.Explorer explorer)
        {
            try { AttachExplorer(explorer); }
            catch (COMException) { }
        }

        private void Application_NewInspector(OfficeOutlook.Inspector inspector)
        {
            try { AttachInspector(inspector); }
            catch (COMException) { }
        }

        private void AttachExplorer(OfficeOutlook.Explorer explorer)
        {
            if (explorer == null || explorerContexts.ContainsKey(explorer)) return;
            var pane = new EmployeeTaskPane(api, ReadMailboxAddress(), IsArabic());
            var taskPane = CustomTaskPanes.Add(pane, IsArabic() ? PaneTitleArabic : PaneTitleEnglish, explorer);
            taskPane.Width = 360;
            taskPane.Visible = true;
            var context = new ExplorerContext(explorer, pane, taskPane);
            context.SelectionChanged = delegate { HandleExplorerSelection(context); };
            context.Closed = delegate { RemoveExplorer(context); };
            ((OfficeOutlook.ExplorerEvents_10_Event)explorer).SelectionChange += context.SelectionChanged;
            ((OfficeOutlook.ExplorerEvents_10_Event)explorer).Close += context.Closed;
            explorerContexts.Add(explorer, context);
            HandleExplorerSelection(context);
        }

        private void AttachInspector(OfficeOutlook.Inspector inspector)
        {
            if (inspector == null || inspectorContexts.ContainsKey(inspector)) return;
            var pane = new EmployeeTaskPane(api, ReadMailboxAddress(), IsArabic());
            var taskPane = CustomTaskPanes.Add(pane, IsArabic() ? PaneTitleArabic : PaneTitleEnglish, inspector);
            taskPane.Width = 360;
            taskPane.Visible = true;
            var context = new InspectorContext(inspector, pane, taskPane);
            context.Activated = delegate { HandleInspectorSelection(context); };
            context.Closed = delegate { RemoveInspector(context); };
            ((OfficeOutlook.InspectorEvents_10_Event)inspector).Activate += context.Activated;
            ((OfficeOutlook.InspectorEvents_10_Event)inspector).Close += context.Closed;
            inspectorContexts.Add(inspector, context);
            HandleInspectorSelection(context);
        }

        private void HandleExplorerSelection(ExplorerContext context)
        {
            try
            {
                var selection = context.Explorer.Selection;
                if (selection == null || selection.Count != 1)
                {
                    context.Pane.ClearSelection();
                    return;
                }
                var message = ReadMailItem(selection[1] as OfficeOutlook.MailItem, ReadMailboxAddress());
                if (message == null) context.Pane.ClearSelection();
                else _ = context.Pane.SelectAsync(message);
            }
            catch (COMException) { }
        }

        private void HandleInspectorSelection(InspectorContext context)
        {
            try
            {
                var message = ReadMailItem(context.Inspector.CurrentItem as OfficeOutlook.MailItem, ReadMailboxAddress());
                if (message == null) context.Pane.ClearSelection();
                else _ = context.Pane.SelectAsync(message);
            }
            catch (COMException) { }
        }

        private static OutlookMessage ReadMailItem(OfficeOutlook.MailItem mail, string mailboxAddress)
        {
            if (mail == null) return null;
            var entryId = string.Empty;
            try { entryId = mail.EntryID ?? string.Empty; }
            catch (COMException) { }
            var storeId = string.Empty;
            try
            {
                var folder = mail.Parent as OfficeOutlook.MAPIFolder;
                if (folder != null) storeId = folder.StoreID ?? string.Empty;
            }
            catch (COMException) { }

            var messageId = string.Empty;
            try
            {
                var value = mail.PropertyAccessor.GetProperty(InternetMessageIdProperty);
                messageId = Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
            }
            catch (COMException) { }

            string subject = string.Empty;
            string body = string.Empty;
            try { subject = mail.Subject ?? string.Empty; }
            catch (COMException) { }
            try { body = mail.Body ?? string.Empty; }
            catch (COMException) { }
            return new OutlookMessage(messageId, entryId, storeId, subject, body, mailboxAddress);
        }

        private void RemoveExplorer(ExplorerContext context)
        {
            if (context == null) return;
            explorerContexts.Remove(context.Explorer);
            context.Dispose();
        }

        private void RemoveInspector(InspectorContext context)
        {
            if (context == null) return;
            inspectorContexts.Remove(context.Inspector);
            context.Dispose();
        }

        private void Application_Quit()
        {
            ShutdownBridge();
        }

        private string ReadMailboxAddress()
        {
            if (outlookApplication == null || outlookApplication.Session == null) return string.Empty;
            try
            {
                foreach (OfficeOutlook.Account account in outlookApplication.Session.Accounts)
                {
                    if (!string.IsNullOrWhiteSpace(account.SmtpAddress)) return account.SmtpAddress;
                }
            }
            catch (COMException) { }
            return string.Empty;
        }

        private static bool IsArabic()
        {
            return string.Equals(
                CultureInfo.CurrentUICulture.TwoLetterISOLanguageName,
                "ar",
                StringComparison.OrdinalIgnoreCase);
        }

        private static string ReadSentinelOrigin()
        {
            using (var key = Registry.LocalMachine.OpenSubKey(RegistryPath, false))
            {
                var value = key == null ? null : key.GetValue(OriginValue) as string;
                Uri parsed;
                if (string.IsNullOrWhiteSpace(value) ||
                    !Uri.TryCreate(value, UriKind.Absolute, out parsed) ||
                    !string.Equals(parsed.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
                    !string.IsNullOrEmpty(parsed.UserInfo) || parsed.Query.Length != 0 ||
                    parsed.Fragment.Length != 0 ||
                    (parsed.AbsolutePath != "/" && parsed.AbsolutePath.Length != 0))
                    throw new InvalidOperationException("The installed Sentinel HTTPS origin is missing or invalid.");
                return parsed.GetLeftPart(UriPartial.Authority) + "/";
            }
        }

        private void ShutdownBridge()
        {
            if (disposed) return;
            disposed = true;
            if (outlookApplication != null)
            {
                try
                {
                    ((OfficeOutlook.ExplorersEvents_Event)outlookApplication.Explorers).NewExplorer -= Application_NewExplorer;
                    ((OfficeOutlook.InspectorsEvents_Event)outlookApplication.Inspectors).NewInspector -= Application_NewInspector;
                    ((OfficeOutlook.ApplicationEvents_11_Event)outlookApplication).Quit -= Application_Quit;
                }
                catch (COMException) { }
            }
            foreach (var context in explorerContexts.Values.ToList()) context.Dispose();
            foreach (var context in inspectorContexts.Values.ToList()) context.Dispose();
            explorerContexts.Clear();
            inspectorContexts.Clear();
            if (api != null) api.Dispose();
            api = null;
        }

        private sealed class ExplorerContext : IDisposable
        {
            internal ExplorerContext(OfficeOutlook.Explorer explorer, EmployeeTaskPane pane, CustomTaskPane taskPane)
            {
                Explorer = explorer;
                Pane = pane;
                TaskPane = taskPane;
            }

            internal OfficeOutlook.Explorer Explorer { get; private set; }
            internal EmployeeTaskPane Pane { get; private set; }
            internal CustomTaskPane TaskPane { get; private set; }
            internal OfficeOutlook.ExplorerEvents_10_SelectionChangeEventHandler SelectionChanged;
            internal OfficeOutlook.ExplorerEvents_10_CloseEventHandler Closed;

            public void Dispose()
            {
                try
                {
                    if (SelectionChanged != null) ((OfficeOutlook.ExplorerEvents_10_Event)Explorer).SelectionChange -= SelectionChanged;
                    if (Closed != null) ((OfficeOutlook.ExplorerEvents_10_Event)Explorer).Close -= Closed;
                }
                catch (COMException) { }
                if (TaskPane != null) TaskPane.Dispose();
                if (Pane != null) Pane.Dispose();
            }
        }

        private sealed class InspectorContext : IDisposable
        {
            internal InspectorContext(OfficeOutlook.Inspector inspector, EmployeeTaskPane pane, CustomTaskPane taskPane)
            {
                Inspector = inspector;
                Pane = pane;
                TaskPane = taskPane;
            }

            internal OfficeOutlook.Inspector Inspector { get; private set; }
            internal EmployeeTaskPane Pane { get; private set; }
            internal CustomTaskPane TaskPane { get; private set; }
            internal OfficeOutlook.InspectorEvents_10_ActivateEventHandler Activated;
            internal OfficeOutlook.InspectorEvents_10_CloseEventHandler Closed;

            public void Dispose()
            {
                try
                {
                    if (Activated != null) ((OfficeOutlook.InspectorEvents_10_Event)Inspector).Activate -= Activated;
                    if (Closed != null) ((OfficeOutlook.InspectorEvents_10_Event)Inspector).Close -= Closed;
                }
                catch (COMException) { }
                if (TaskPane != null) TaskPane.Dispose();
                if (Pane != null) Pane.Dispose();
            }
        }
    }
}
