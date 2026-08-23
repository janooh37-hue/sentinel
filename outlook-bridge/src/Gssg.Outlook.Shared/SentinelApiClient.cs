using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Gssg.Outlook
{
    [Serializable]
    internal sealed class ApiException : Exception
    {
        internal ApiException(string message, HttpStatusCode statusCode) : base(message)
        {
            StatusCode = statusCode;
        }

        internal HttpStatusCode StatusCode { get; private set; }
    }

    [DataContract]
    internal sealed class PairDeviceRequest
    {
        [DataMember(Name = "token")] internal string Token;
        [DataMember(Name = "device_id")] internal string DeviceId;
        [DataMember(Name = "device_label")] internal string DeviceLabel;
        [DataMember(Name = "mailbox_address")] internal string MailboxAddress;
    }

    [DataContract]
    internal sealed class PairDeviceResponse
    {
        [DataMember(Name = "credential")] internal string Credential;
    }

    [DataContract]
    internal sealed class RedeemHandoffRequest
    {
        [DataMember(Name = "token")] internal string Token;
    }

    [DataContract]
    internal sealed class AttachmentRef
    {
        [DataMember(Name = "kind")] internal string Kind;
        [DataMember(Name = "document_id")] internal int DocumentId;
        [DataMember(Name = "filename")] internal string Filename;
    }

    [DataContract]
    internal sealed class HandoffPayload
    {
        [DataMember(Name = "to")] internal List<string> To;
        [DataMember(Name = "cc")] internal List<string> Cc;
        [DataMember(Name = "subject")] internal string Subject;
        [DataMember(Name = "body_html")] internal string BodyHtml;
        [DataMember(Name = "basket_key")] internal string BasketKey;
        [DataMember(Name = "attachments")] internal List<AttachmentRef> Attachments;
        [DataMember(Name = "ledger_entry_id")] internal int LedgerEntryId;
        [DataMember(Name = "outlook_store_id")] internal string OutlookStoreId;
        [DataMember(Name = "outlook_entry_id")] internal string OutlookEntryId;
        [DataMember(Name = "internet_message_id")] internal string InternetMessageId;

        internal HandoffPayload()
        {
            To = new List<string>();
            Cc = new List<string>();
            Attachments = new List<AttachmentRef>();
        }
    }

    [DataContract]
    internal sealed class RedeemHandoffResponse
    {
        [DataMember(Name = "handoff_id")] internal int HandoffId;
        [DataMember(Name = "kind")] internal string Kind;
        [DataMember(Name = "payload")] internal HandoffPayload Payload;
    }

    [DataContract]
    internal sealed class HandoffCompletionResponse
    {
        [DataMember(Name = "status")] internal string Status;
        [DataMember(Name = "failure_code")] internal string FailureCode;
    }
    [DataContract]
    internal sealed class HandoffFailureRequest
    {
        [DataMember(Name = "failure_code")] internal string FailureCode;
    }


    [DataContract]
    internal sealed class SelectionRequest
    {
        [DataMember(Name = "internet_message_id")] internal string InternetMessageId;
        [DataMember(Name = "outlook_store_id")] internal string OutlookStoreId;
        [DataMember(Name = "outlook_entry_id")] internal string OutlookEntryId;
        [DataMember(Name = "g_numbers")] internal List<string> GNumbers;
    }

    [DataContract]
    internal sealed class OutlookEmployeeSummary
    {
        [DataMember(Name = "employee_id")] internal string EmployeeId;
        [DataMember(Name = "name_en")] internal string NameEn;
        [DataMember(Name = "name_ar")] internal string NameAr;
        [DataMember(Name = "status")] internal string Status;
        [DataMember(Name = "position")] internal string Position;
        [DataMember(Name = "photo_version")] internal string PhotoVersion;
        [DataMember(Name = "recording_pending")] internal bool RecordingPending;
    }

    [DataContract]
    internal sealed class OutlookSelectionResponse
    {
        [DataMember(Name = "indexed")] internal bool Indexed;
        [DataMember(Name = "recording_pending")] internal bool RecordingPending;
        [DataMember(Name = "entry_id")] internal int? EntryId;
        [DataMember(Name = "employees")] internal List<OutlookEmployeeSummary> Employees;
    }

    internal interface ISelectionApi
    {
        Task<OutlookSelectionResponse> ResolveSelectionAsync(SelectionRequest request, CancellationToken cancellationToken);
        Task<IReadOnlyList<OutlookEmployeeSummary>> SearchEmployeesAsync(string query, CancellationToken cancellationToken);
        Task LinkEmployeeAsync(int entryId, string employeeId, CancellationToken cancellationToken);
        Task DismissEmployeeAsync(int entryId, string employeeId, CancellationToken cancellationToken);
        Task<byte[]> GetEmployeePhotoAsync(string employeeId, CancellationToken cancellationToken);
        Uri EmployeeProfileUri(string employeeId);
    }

    internal sealed class SentinelApiClient : IDisposable, ISelectionApi
    {
        private readonly HttpClient client;
        private readonly Uri origin;
        private readonly CredentialStore credentialStore;
        private bool disposed;

        internal SentinelApiClient(string sentinelOrigin, CredentialStore credentialStore)
            : this(sentinelOrigin, credentialStore, new HttpClientHandler())
        {
        }

        internal SentinelApiClient(string sentinelOrigin, CredentialStore credentialStore, HttpMessageHandler handler)
        {
            origin = ValidateOrigin(sentinelOrigin);
            this.credentialStore = credentialStore ?? throw new ArgumentNullException(nameof(credentialStore));
            client = new HttpClient(handler ?? throw new ArgumentNullException(nameof(handler)))
            {
                Timeout = TimeSpan.FromSeconds(30)
            };
        }

        internal string Credential { get { return credentialStore.Read(); } }

        internal void Pair(string token, string mailboxAddress)
        {
            var response = Send<PairDeviceResponse>(
                HttpMethod.Post,
                "api/v1/outlook/device/pair",
                null,
                new PairDeviceRequest
                {
                    Token = token,
                    DeviceId = Environment.MachineName,
                    DeviceLabel = Environment.MachineName + " Outlook",
                    MailboxAddress = mailboxAddress
                });
            if (string.IsNullOrWhiteSpace(response.Credential))
                throw new ApiException("The pairing response did not contain a credential.", HttpStatusCode.BadGateway);
            credentialStore.Write(response.Credential);
        }

        internal RedeemHandoffResponse RedeemHandoff(string token)
        {
            return Send<RedeemHandoffResponse>(
                HttpMethod.Post,
                "api/v1/outlook/device/handoffs/redeem",
                credentialStore.Read(),
                new RedeemHandoffRequest { Token = token });
        }

        internal string DownloadAttachment(int handoffId, int index, string fileName)
        {
            var safeName = Path.GetFileName(fileName);
            if (string.IsNullOrWhiteSpace(fileName) || safeName != fileName || string.IsNullOrWhiteSpace(safeName) ||
                safeName == "." || safeName == ".." || safeName.IndexOf('\0') >= 0)
                throw new ArgumentException("Attachment filename must be a basename.", nameof(fileName));

            var request = new HttpRequestMessage(
                HttpMethod.Get,
                Endpoint("api/v1/outlook/device/handoffs/" + handoffId + "/attachments/" + index));
            AddBearer(request, credentialStore.Read());
            using (var response = client.SendAsync(request).GetAwaiter().GetResult())
            {
                EnsureSuccess(response);
                var directory = Path.Combine(Path.GetTempPath(), "Gssg.Outlook", Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(directory);
                var path = Path.Combine(directory, safeName);
                try
                {
                    using (var input = response.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
                    using (var output = File.Create(path))
                    {
                        input.CopyTo(output);
                    }
                    return path;
                }
                catch
                {
                    TryDelete(path);
                    TryDelete(directory);
                    throw;
                }
            }
        }

        internal void CompleteHandoff(int handoffId)
        {
            Send<HandoffCompletionResponse>(
                HttpMethod.Post,
                "api/v1/outlook/device/handoffs/" + handoffId + "/complete",
                credentialStore.Read(),
                null);
        }

        internal void FailHandoff(int handoffId, string failureCode)
        {
            Send<HandoffCompletionResponse>(
                HttpMethod.Post,
                "api/v1/outlook/device/handoffs/" + handoffId + "/fail",
                credentialStore.Read(),
                new HandoffFailureRequest { FailureCode = failureCode });
        }

        internal void PostSelection(string internetMessageId, string storeId, string entryId, IReadOnlyList<string> gNumbers)
        {
            Send<object>(
                HttpMethod.Post,
                "api/v1/outlook/device/selection",
                credentialStore.Read(),
                new SelectionRequest
                {
                    InternetMessageId = internetMessageId,
                    OutlookStoreId = storeId,
                    OutlookEntryId = entryId,
                    GNumbers = new List<string>(gNumbers ?? new string[0])
                });
        }

        public async Task<OutlookSelectionResponse> ResolveSelectionAsync(
            SelectionRequest request,
            CancellationToken cancellationToken)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            return await SendAsync<OutlookSelectionResponse>(
                HttpMethod.Post,
                "api/v1/outlook/device/selection",
                credentialStore.Read(),
                request,
                cancellationToken).ConfigureAwait(false);
        }

        public async Task<IReadOnlyList<OutlookEmployeeSummary>> SearchEmployeesAsync(
            string query,
            CancellationToken cancellationToken)
        {
            var encoded = Uri.EscapeDataString(query ?? string.Empty);
            var result = await SendAsync<List<OutlookEmployeeSummary>>(
                HttpMethod.Get,
                "api/v1/outlook/device/employees?q=" + encoded + "&limit=20",
                credentialStore.Read(),
                null,
                cancellationToken).ConfigureAwait(false);
            return result ?? new List<OutlookEmployeeSummary>();
        }

        public async Task LinkEmployeeAsync(
            int entryId,
            string employeeId,
            CancellationToken cancellationToken)
        {
            await SendAsync<object>(
                HttpMethod.Put,
                "api/v1/outlook/device/messages/" + entryId + "/employees/" +
                    Uri.EscapeDataString(employeeId ?? string.Empty),
                credentialStore.Read(),
                null,
                cancellationToken).ConfigureAwait(false);
        }

        public async Task DismissEmployeeAsync(
            int entryId,
            string employeeId,
            CancellationToken cancellationToken)
        {
            await SendAsync<object>(
                HttpMethod.Delete,
                "api/v1/outlook/device/messages/" + entryId + "/employees/" +
                    Uri.EscapeDataString(employeeId ?? string.Empty),
                credentialStore.Read(),
                null,
                cancellationToken).ConfigureAwait(false);
        }

        public async Task<byte[]> GetEmployeePhotoAsync(
            string employeeId,
            CancellationToken cancellationToken)
        {
            EnsureNotDisposed();
            using (var request = new HttpRequestMessage(
                HttpMethod.Get,
                Endpoint("api/v1/outlook/device/employees/" +
                    Uri.EscapeDataString(employeeId ?? string.Empty) + "/photo")))
            {
                AddBearer(request, credentialStore.Read());
                using (var response = await client.SendAsync(
                    request,
                    HttpCompletionOption.ResponseHeadersRead,
                    cancellationToken).ConfigureAwait(false))
                {
                    EnsureSuccess(response);
                    return await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
                }
            }
        }

        public Uri EmployeeProfileUri(string employeeId)
        {
            if (string.IsNullOrWhiteSpace(employeeId))
                throw new ArgumentException("Employee ID is required.", nameof(employeeId));
            return Endpoint("employees/" + Uri.EscapeDataString(employeeId.Trim()));
        }

        private async Task<T> SendAsync<T>(
            HttpMethod method,
            string path,
            string bearer,
            object body,
            CancellationToken cancellationToken)
        {
            EnsureNotDisposed();
            using (var request = new HttpRequestMessage(method, Endpoint(path)))
            {
                AddBearer(request, bearer);
                if (body != null)
                {
                    request.Content = new ByteArrayContent(Serialize(body));
                    request.Content.Headers.ContentType =
                        new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
                }
                using (var response = await client.SendAsync(
                    request,
                    HttpCompletionOption.ResponseHeadersRead,
                    cancellationToken).ConfigureAwait(false))
                {
                    EnsureSuccess(response);
                    if (typeof(T) == typeof(object)) return default(T);
                    var bytes = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
                    return Deserialize<T>(bytes);
                }
            }
        }

        private T Send<T>(HttpMethod method, string path, string bearer, object body)
        {
            EnsureNotDisposed();
            using (var request = new HttpRequestMessage(method, Endpoint(path)))
            {
                AddBearer(request, bearer);
                if (body != null)
                {
                    request.Content = new ByteArrayContent(Serialize(body));
                    request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
                }
                using (var response = client.SendAsync(request).GetAwaiter().GetResult())
                {
                    EnsureSuccess(response);
                    if (typeof(T) == typeof(object)) return default(T);
                    var bytes = response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult();
                    return Deserialize<T>(bytes);
                }
            }
        }

        private static Uri ValidateOrigin(string value)
        {
            Uri parsed;
            if (!Uri.TryCreate(value, UriKind.Absolute, out parsed) ||
                !string.Equals(parsed.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
                !string.IsNullOrEmpty(parsed.UserInfo) || parsed.Query.Length != 0 || parsed.Fragment.Length != 0 ||
                (parsed.AbsolutePath != "/" && parsed.AbsolutePath.Length != 0))
                throw new ArgumentException("SentinelOrigin must be an HTTPS origin.", nameof(value));
            return new Uri(parsed.GetLeftPart(UriPartial.Authority) + "/", UriKind.Absolute);
        }

        private Uri Endpoint(string path)
        {
            return new Uri(origin, path.TrimStart('/'));
        }

        private static void AddBearer(HttpRequestMessage request, string bearer)
        {
            if (!string.IsNullOrWhiteSpace(bearer)) request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bearer);
        }

        private static byte[] Serialize(object value)
        {
            var serializer = new DataContractJsonSerializer(value.GetType());
            using (var stream = new MemoryStream())
            {
                serializer.WriteObject(stream, value);
                return stream.ToArray();
            }
        }

        private static T Deserialize<T>(byte[] bytes)
        {
            var serializer = new DataContractJsonSerializer(typeof(T));
            using (var stream = new MemoryStream(bytes))
            {
                return (T)serializer.ReadObject(stream);
            }
        }

        private static void EnsureSuccess(HttpResponseMessage response)
        {
            if (response.IsSuccessStatusCode) return;
            var message = "Sentinel request failed with HTTP " + (int)response.StatusCode + ".";
            throw new ApiException(message, response.StatusCode);
        }

        private static void TryDelete(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return;
            try
            {
                if (Directory.Exists(path)) Directory.Delete(path, true);
                else if (File.Exists(path)) File.Delete(path);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        private void EnsureNotDisposed()
        {
            if (disposed) throw new ObjectDisposedException(nameof(SentinelApiClient));
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            client.Dispose();
        }
    }
}
