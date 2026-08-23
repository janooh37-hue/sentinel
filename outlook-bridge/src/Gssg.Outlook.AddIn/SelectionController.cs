using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Gssg.Outlook;

namespace Gssg.Outlook.AddIn
{
    internal sealed class OutlookMessage
    {
        internal OutlookMessage(
            string messageId,
            string entryId,
            string storeId,
            string subject,
            string body,
            string mailboxAddress)
        {
            MessageId = messageId ?? string.Empty;
            EntryId = entryId ?? string.Empty;
            StoreId = storeId ?? string.Empty;
            Subject = subject ?? string.Empty;
            Body = body ?? string.Empty;
            MailboxAddress = mailboxAddress ?? string.Empty;
        }

        internal string MessageId { get; private set; }
        internal string InternetMessageId { get { return MessageId; } }
        internal string EntryId { get; private set; }
        internal string StoreId { get; private set; }
        internal string Subject { get; private set; }
        internal string Body { get; private set; }
        internal string MailboxAddress { get; private set; }

        internal bool HasIndexedEntryId { get { return !string.IsNullOrWhiteSpace(EntryId); } }
    }

    internal enum SelectionStatus
    {
        Empty,
        Loading,
        Ready,
        Error
    }

    internal sealed class SelectionState
    {
        internal SelectionState(
            SelectionStatus status,
            OutlookMessage message,
            IReadOnlyList<OutlookEmployeeSummary> employees,
            bool indexed,
            bool recordingPending,
            int? entryId,
            string errorMessage)
        {
            Status = status;
            Message = message;
            MessageId = message == null ? string.Empty : message.MessageId;
            Employees = employees ?? new List<OutlookEmployeeSummary>();
            Indexed = indexed;
            RecordingPending = recordingPending;
            EntryId = entryId;
            ErrorMessage = errorMessage ?? string.Empty;
        }

        internal SelectionStatus Status { get; private set; }
        internal OutlookMessage Message { get; private set; }
        internal string MessageId { get; private set; }
        internal IReadOnlyList<OutlookEmployeeSummary> Employees { get; private set; }
        internal bool Indexed { get; private set; }
        internal bool RecordingPending { get; private set; }
        internal int? EntryId { get; private set; }
        internal string ErrorMessage { get; private set; }
        internal bool CanMutate { get { return Indexed && EntryId.HasValue; } }
    }

    internal sealed class SelectionController : IDisposable
    {
        private readonly ISelectionApi api;
        private readonly SynchronizationContext synchronizationContext;
        private readonly object gate = new object();
        private CancellationTokenSource selectionCancellation;
        private int generation;
        private bool disposed;
        private OutlookMessage currentMessage;
        private SelectionState state;

        internal SelectionController(ISelectionApi api)
        {
            this.api = api ?? throw new ArgumentNullException(nameof(api));
            synchronizationContext = SynchronizationContext.Current;
            state = new SelectionState(
                SelectionStatus.Empty,
                null,
                new List<OutlookEmployeeSummary>(),
                false,
                false,
                null,
                string.Empty);
        }

        internal SelectionState State
        {
            get
            {
                lock (gate) return state;
            }
        }

        internal void Clear()
        {
            lock (gate)
            {
                EnsureNotDisposed();
                ++generation;
                currentMessage = null;
                if (selectionCancellation != null) selectionCancellation.Cancel();
                if (selectionCancellation != null) selectionCancellation.Dispose();
                selectionCancellation = null;
                state = new SelectionState(
                    SelectionStatus.Empty,
                    null,
                    new List<OutlookEmployeeSummary>(),
                    false,
                    false,
                    null,
                    string.Empty);
            }
            PublishStateChanged();
        }
        internal OutlookMessage CurrentMessage
        {
            get
            {
                lock (gate) return currentMessage;
            }
        }

        internal event EventHandler StateChanged;

        internal Task SelectAsync(OutlookMessage message)
        {
            if (message == null) throw new ArgumentNullException(nameof(message));

            CancellationTokenSource cancellation;
            int requestGeneration;
            lock (gate)
            {
                EnsureNotDisposed();
                requestGeneration = ++generation;
                currentMessage = message;
                if (selectionCancellation != null) selectionCancellation.Cancel();
                if (selectionCancellation != null) selectionCancellation.Dispose();
                selectionCancellation = new CancellationTokenSource();
                cancellation = selectionCancellation;
                state = new SelectionState(
                    SelectionStatus.Loading,
                    message,
                    new List<OutlookEmployeeSummary>(),
                    false,
                    false,
                    null,
                    string.Empty);
            }
            PublishStateChanged();
            return ResolveAsync(message, requestGeneration, cancellation);
        }

        internal Task RefreshCurrentAsync()
        {
            OutlookMessage message;
            lock (gate) message = currentMessage;
            return message == null ? Task.CompletedTask : SelectAsync(message);
        }

        internal async Task<bool> AddEmployeeAsync(string employeeId)
        {
            return await MutateAsync(employeeId, false).ConfigureAwait(false);
        }

        internal async Task<bool> DismissEmployeeAsync(string employeeId)
        {
            return await MutateAsync(employeeId, true).ConfigureAwait(false);
        }

        private async Task<bool> MutateAsync(string employeeId, bool dismiss)
        {
            if (string.IsNullOrWhiteSpace(employeeId)) return false;
            SelectionState snapshot;
            lock (gate) snapshot = state;
            if (!snapshot.CanMutate) return false;

            try
            {
                using (var actionCancellation = new CancellationTokenSource())
                {
                    if (dismiss)
                        await api.DismissEmployeeAsync(snapshot.EntryId.Value, employeeId, actionCancellation.Token).ConfigureAwait(false);
                    else
                        await api.LinkEmployeeAsync(snapshot.EntryId.Value, employeeId, actionCancellation.Token).ConfigureAwait(false);
                }
                await RefreshCurrentAsync().ConfigureAwait(false);
                return true;
            }
            catch (OperationCanceledException)
            {
                return false;
            }
        }

        private async Task ResolveAsync(
            OutlookMessage message,
            int requestGeneration,
            CancellationTokenSource cancellation)
        {
            try
            {
                var response = await api.ResolveSelectionAsync(
                    new SelectionRequest
                    {
                        InternetMessageId = message.InternetMessageId,
                        OutlookStoreId = message.StoreId,
                        OutlookEntryId = message.EntryId,
                        GNumbers = GNumberDetector.Detect(message.Subject + "\n" + message.Body).ToList()
                    },
                    cancellation.Token).ConfigureAwait(false);

                lock (gate)
                {
                    if (!IsCurrent(requestGeneration, cancellation)) return;
                    response = response ?? new OutlookSelectionResponse();
                    state = new SelectionState(
                        SelectionStatus.Ready,
                        message,
                        response.Employees ?? new List<OutlookEmployeeSummary>(),
                        response.Indexed,
                        response.RecordingPending,
                        response.EntryId,
                        string.Empty);
                }
                PublishStateChanged();
            }
            catch (OperationCanceledException)
            {
                // Cancellation is expected whenever Outlook moves to a new item.
            }
            catch (Exception exception)
            {
                lock (gate)
                {
                    if (!IsCurrent(requestGeneration, cancellation)) return;
                    state = new SelectionState(
                        SelectionStatus.Error,
                        message,
                        new List<OutlookEmployeeSummary>(),
                        false,
                        false,
                        null,
                        exception.Message);
                }
                PublishStateChanged();
            }
        }

        private bool IsCurrent(int requestGeneration, CancellationTokenSource cancellation)
        {
            return !disposed && requestGeneration == generation && ReferenceEquals(cancellation, selectionCancellation);
        }

        private void PublishStateChanged()
        {
            var handler = StateChanged;
            if (handler == null) return;
            if (synchronizationContext == null)
            {
                handler(this, EventArgs.Empty);
                return;
            }
            synchronizationContext.Post(delegate { handler(this, EventArgs.Empty); }, null);
        }

        private void EnsureNotDisposed()
        {
            if (disposed) throw new ObjectDisposedException(nameof(SelectionController));
        }

        public void Dispose()
        {
            lock (gate)
            {
                if (disposed) return;
                disposed = true;
                ++generation;
                if (selectionCancellation != null) selectionCancellation.Cancel();
                if (selectionCancellation != null) selectionCancellation.Dispose();
                selectionCancellation = null;
            }
        }
    }
}
