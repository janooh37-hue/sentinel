using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.Win32;
using Gssg.Outlook;

namespace Gssg.Outlook.Launcher
{
    internal static class Program
    {
        internal static int Main(string[] args)
        {
            try
            {
                if (args != null && args.Length == 1 && string.Equals(args[0], "--self-test", StringComparison.OrdinalIgnoreCase))
                    return RunSelfTest();
                if (args == null || args.Length != 1)
                    throw new ProtocolException("An Outlook bridge protocol URI is required.");

                var command = ProtocolCommand.Parse(args[0]);
                var origin = InstallerConfiguration.ReadSentinelOrigin();
                var credentials = new CredentialStore();
                using (var api = new SentinelApiClient(origin, credentials))
                {
                    RetryPendingCompletions(api);
                    switch (command.Kind)
                    {
                        case CommandKind.Pair:
                            return RunPair(command.Token, api);
                        case CommandKind.Compose:
                            return RunCompose(command.Token, api, credentials);
                        case CommandKind.Open:
                            return RunOpen(command.Token, api, credentials);
                        default:
                            throw new ProtocolException("Unknown Outlook bridge command.");
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(UserMessage(ex));
                return 1;
            }
        }

        private static int RunSelfTest()
        {
            var origin = InstallerConfiguration.ReadSentinelOrigin();
            var credentials = new CredentialStore();
            credentials.Read();
            if (!InstallerConfiguration.IsProtocolRegistered())
                throw new NativeOutlookException("PROTOCOL_NOT_REGISTERED", "The Outlook bridge protocol handler is not registered.");
            using (var outlook = new OutlookClient())
            {
                outlook.DiscoverActiveMailbox();
            }
            Console.WriteLine("Self-test passed for SentinelOrigin " + origin);
            return 0;
        }

        private static int RunPair(string token, SentinelApiClient api)
        {
            using (var outlook = new OutlookClient())
            {
                var mailbox = outlook.DiscoverActiveMailbox();
                api.Pair(token, mailbox.SmtpAddress);
                Console.WriteLine("Outlook bridge paired for " + mailbox.SmtpAddress + ".");
            }
            return 0;
        }

        private static int RunCompose(string token, SentinelApiClient api, CredentialStore credentials)
        {
            RequireCredential(credentials);
            var handoff = api.RedeemHandoff(token);
            if (!string.Equals(handoff.Kind, "compose", StringComparison.OrdinalIgnoreCase) || handoff.Payload == null)
                throw new NativeOutlookException("HANDOFF_INVALID", "The compose handoff was not valid.");

            try
            {
                using (var outlook = new OutlookClient())
                    outlook.CreateDraft(handoff.Payload, handoff.HandoffId, api);
            }
            catch (Exception ex)
            {
                TryFail(api, handoff.HandoffId, FailureCode(ex));
                throw;
            }

            CompleteOrRecord(api, handoff.HandoffId);
            Console.WriteLine("Outlook draft created.");
            return 0;
        }

        private static int RunOpen(string token, SentinelApiClient api, CredentialStore credentials)
        {
            RequireCredential(credentials);
            var handoff = api.RedeemHandoff(token);
            try
            {
                if (!string.Equals(handoff.Kind, "open", StringComparison.OrdinalIgnoreCase) || handoff.Payload == null)
                    throw new NativeOutlookException("HANDOFF_INVALID", "The open handoff was not valid.");
                if (string.IsNullOrWhiteSpace(handoff.Payload.OutlookEntryId) || string.IsNullOrWhiteSpace(handoff.Payload.OutlookStoreId) ||
                    string.IsNullOrWhiteSpace(handoff.Payload.InternetMessageId))
                    throw new NativeOutlookException("MESSAGE_NOT_FOUND", "The exact Outlook location was not available for this correspondence.");

                OpenMessageResult result;
                using (var outlook = new OutlookClient())
                    result = outlook.OpenMessage(handoff.Payload.OutlookEntryId, handoff.Payload.OutlookStoreId, handoff.Payload.InternetMessageId);
                api.PostSelection(result.InternetMessageId, result.StoreId, result.EntryId, result.GNumbers);
                CompleteOrRecord(api, handoff.HandoffId);
                Console.WriteLine("Opened Outlook message " + result.InternetMessageId + ".");
                return 0;
            }
            catch (Exception ex)
            {
                var native = ex as NativeOutlookException;
                if (native == null || !string.Equals(native.Code, "COMPLETION_RETRY_REQUIRED", StringComparison.Ordinal))
                    TryFail(api, handoff.HandoffId, FailureCode(ex));
                throw;
            }
        }

        private static void RequireCredential(CredentialStore credentials)
        {
            if (string.IsNullOrWhiteSpace(credentials.Read()))
                throw new NativeOutlookException("PAIRING_REQUIRED", "Pair the Outlook bridge before using this action.");
        }

        private static void CompleteOrRecord(SentinelApiClient api, int handoffId)
        {
            try
            {
                api.CompleteHandoff(handoffId);
            }
            catch (Exception ex)
            {
                CompletionReceipts.Add(handoffId);
                throw new NativeOutlookException("COMPLETION_RETRY_REQUIRED", "The Outlook action completed, but Sentinel could not record completion. It will retry status only.", ex);
            }
        }

        private static void RetryPendingCompletions(SentinelApiClient api)
        {
            foreach (var handoffId in CompletionReceipts.Read())
            {
                try
                {
                    api.CompleteHandoff(handoffId);
                    CompletionReceipts.Remove(handoffId);
                }
                catch (ApiException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Conflict)
                {
                    // The server already reached a terminal state; do not repeat the native action.
                    CompletionReceipts.Remove(handoffId);
                }
                catch
                {
                    // Leave the receipt for the next launcher invocation.
                }
            }
        }

        private static void TryFail(SentinelApiClient api, int handoffId, string failureCode)
        {
            try { api.FailHandoff(handoffId, failureCode); }
            catch { }
        }

        private static string FailureCode(Exception ex)
        {
            var native = ex as NativeOutlookException;
            if (native != null) return native.Code;
            if (ex is ApiException) return "API_FAILURE";
            return "NATIVE_FAILURE";
        }

        private static string UserMessage(Exception ex)
        {
            var native = ex as NativeOutlookException;
            if (native != null) return native.Message;
            var protocol = ex as ProtocolException;
            if (protocol != null) return protocol.Message;
            var api = ex as ApiException;
            if (api != null)
            {
                if (api.StatusCode == System.Net.HttpStatusCode.Unauthorized) return "Pairing is required or the Outlook bridge credential was revoked.";
                if (api.StatusCode == System.Net.HttpStatusCode.NotFound) return "The Outlook handoff or message was not found.";
                if (api.StatusCode == System.Net.HttpStatusCode.Conflict) return "The Outlook handoff has already been used.";
                return "Sentinel could not complete the Outlook action (HTTP " + (int)api.StatusCode + ").";
            }
            return "The Outlook action failed: " + ex.Message;
        }
    }

    internal static class InstallerConfiguration
    {
        internal const string RegistryPath = "Software\\GSSG Manager\\Outlook Bridge";
        private const string OriginValue = "SentinelOrigin";

        internal static string ReadSentinelOrigin()
        {
            using (var key = Registry.LocalMachine.OpenSubKey(RegistryPath, false))
            {
                var value = key == null ? null : key.GetValue(OriginValue) as string;
                Uri parsed;
                if (string.IsNullOrWhiteSpace(value))
                    throw new NativeOutlookException("INSTALLER_CONFIGURATION_MISSING", "The installed Sentinel HTTPS origin is missing.");
                if (!Uri.TryCreate(value, UriKind.Absolute, out parsed) ||
                    !string.Equals(parsed.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
                    parsed.Query.Length != 0 || parsed.Fragment.Length != 0 ||
                    !string.IsNullOrEmpty(parsed.UserInfo) ||
                    (parsed.AbsolutePath != "/" && parsed.AbsolutePath.Length != 0))
                    throw new NativeOutlookException("INSTALLER_CONFIGURATION_INVALID", "The installed Sentinel origin is not a valid HTTPS origin.");
                return parsed.GetLeftPart(UriPartial.Authority) + "/";
            }
        }

        internal static bool IsProtocolRegistered()
        {
            using (var key = Registry.ClassesRoot.OpenSubKey("gssg-outlook", false))
            {
                if (key == null || !string.Equals(key.GetValue("URL Protocol") as string, string.Empty, StringComparison.Ordinal)) return false;
                using (var command = key.OpenSubKey("shell\\open\\command", false))
                    return command != null && !string.IsNullOrWhiteSpace(command.GetValue(null) as string);
            }
        }
    }

    internal static class CompletionReceipts
    {
        private static readonly object Gate = new object();
        private static string FilePath
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Gssg.Outlook", "completion-receipts.txt"); }
        }

        internal static IReadOnlyList<int> Read()
        {
            lock (Gate)
            {
                if (!File.Exists(FilePath)) return new int[0];
                return File.ReadAllLines(FilePath).Select(value => { int id; return int.TryParse(value, out id) && id > 0 ? (int?)id : null; })
                    .Where(value => value.HasValue).Select(value => value.Value).Distinct().ToArray();
            }
        }

        internal static void Add(int handoffId)
        {
            lock (Gate)
            {
                var values = Read().ToList();
                if (values.Contains(handoffId)) return;
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
                File.AppendAllText(FilePath, handoffId + Environment.NewLine);
            }
        }

        internal static void Remove(int handoffId)
        {
            lock (Gate)
            {
                var remaining = Read().Where(value => value != handoffId).ToArray();
                if (remaining.Length == 0)
                {
                    if (File.Exists(FilePath)) File.Delete(FilePath);
                    return;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
                File.WriteAllLines(FilePath, remaining.Select(value => value.ToString()));
            }
        }
    }
}
