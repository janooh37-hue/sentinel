using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Gssg.Outlook;

namespace Gssg.Outlook.AddIn
{
    internal sealed class EmployeeTaskPane : UserControl
    {
        private readonly ISelectionApi api;
        private readonly SelectionController controller;
        private readonly Label headingLabel;
        private readonly Label mailboxLabel;
        private readonly string mailboxAddress;
        private readonly Label messageLabel;
        private readonly Label stateLabel;
        private readonly FlowLayoutPanel cardsPanel;
        private readonly TextBox searchBox;
        private readonly Button searchButton;
        private readonly Label searchStateLabel;
        private readonly FlowLayoutPanel searchResultsPanel;
        private readonly GroupBox searchGroup;
        private readonly System.Windows.Forms.Timer pendingRefreshTimer;
        private CancellationTokenSource searchCancellation;
        private bool arabic;
        private bool disposed;

        internal EmployeeTaskPane(ISelectionApi api, string mailboxAddress, bool useArabic)
        {
            this.api = api ?? throw new ArgumentNullException(nameof(api));
            this.mailboxAddress = mailboxAddress ?? string.Empty;
            arabic = useArabic;
            controller = new SelectionController(api);
            controller.StateChanged += Controller_StateChanged;
            pendingRefreshTimer = new System.Windows.Forms.Timer { Interval = 2500 };
            pendingRefreshTimer.Tick += PendingRefreshTimer_Tick;

            Dock = DockStyle.Fill;
            BackColor = Color.FromArgb(245, 247, 250);
            Padding = new Padding(8);
            AutoScroll = true;

            headingLabel = CreateLabel(12, true);
            mailboxLabel = CreateLabel(9, false);
            mailboxLabel.Text = mailboxAddress ?? string.Empty;
            messageLabel = CreateLabel(8, false);
            stateLabel = CreateLabel(9, false);

            cardsPanel = new FlowLayoutPanel
            {
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Dock = DockStyle.Top,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                Padding = new Padding(0, 4, 0, 4),
                Margin = new Padding(0)
            };

            searchBox = new TextBox { Width = 190, Margin = new Padding(0, 3, 4, 3) };
            searchButton = new Button { AutoSize = true, Margin = new Padding(0, 3, 0, 3) };
            searchButton.Click += SearchButton_Click;
            searchBox.KeyDown += SearchBox_KeyDown;
            searchStateLabel = CreateLabel(8, false);
            searchResultsPanel = new FlowLayoutPanel
            {
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Dock = DockStyle.Top,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                Margin = new Padding(0),
                Padding = new Padding(0)
            };

            var searchRow = new FlowLayoutPanel
            {
                AutoSize = true,
                Dock = DockStyle.Top,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Margin = new Padding(0),
                Padding = new Padding(0)
            };
            searchRow.Controls.Add(searchBox);
            searchRow.Controls.Add(searchButton);

            searchGroup = new GroupBox
            {
                AutoSize = true,
                Dock = DockStyle.Top,
                Text = string.Empty,
                Padding = new Padding(6),
                Margin = new Padding(0, 5, 0, 0)
            };
            searchGroup.Controls.Add(searchResultsPanel);
            searchGroup.Controls.Add(searchStateLabel);
            searchGroup.Controls.Add(searchRow);

            var root = new FlowLayoutPanel
            {
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Dock = DockStyle.Top,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                Padding = new Padding(0),
                Margin = new Padding(0)
            };
            root.Controls.Add(headingLabel);
            root.Controls.Add(mailboxLabel);
            root.Controls.Add(messageLabel);
            root.Controls.Add(stateLabel);
            root.Controls.Add(cardsPanel);
            root.Controls.Add(searchGroup);
            Controls.Add(root);

            ApplyLanguage();
            RenderState();
        }

        internal SelectionState State { get { return controller.State; } }

        internal Task SelectAsync(OutlookMessage message)
        {
            return controller.SelectAsync(message);
        }
        internal void ClearSelection()
        {
            controller.Clear();
        }

        internal void SetLanguage(bool useArabic)
        {
            arabic = useArabic;
            ApplyLanguage();
            RenderState();
        }

        private void Controller_StateChanged(object sender, EventArgs e)
        {
            if (IsDisposed) return;
            RenderState();
        }

        private void RenderState()
        {
            if (disposed) return;
            var state = controller.State;
            headingLabel.Text = arabic ? "سياق الموظف" : "Employee context";
            messageLabel.Text = string.IsNullOrWhiteSpace(state.MessageId)
                ? string.Empty
                : (arabic ? "المعرف: " + state.MessageId : "Message-ID: " + state.MessageId);
            stateLabel.Text = StateText(state);
            stateLabel.ForeColor = state.Status == SelectionStatus.Error ? Color.Maroon : Color.DimGray;

            if (state.RecordingPending)
                pendingRefreshTimer.Start();
            else
                pendingRefreshTimer.Stop();

            ReplaceCards(state);
            headingLabel.RightToLeft = arabic ? RightToLeft.Yes : RightToLeft.No;
            mailboxLabel.RightToLeft = headingLabel.RightToLeft;
            messageLabel.RightToLeft = headingLabel.RightToLeft;
            stateLabel.RightToLeft = headingLabel.RightToLeft;
            headingLabel.TextAlign = arabic ? ContentAlignment.MiddleRight : ContentAlignment.MiddleLeft;
            mailboxLabel.TextAlign = headingLabel.TextAlign;
            messageLabel.TextAlign = headingLabel.TextAlign;
            stateLabel.TextAlign = headingLabel.TextAlign;
        }

        private void ReplaceCards(SelectionState state)
        {
            DisposeChildren(cardsPanel);
            var summaries = state.Employees ?? new List<OutlookEmployeeSummary>();
            foreach (var summary in summaries)
            {
                var card = new EmployeeCardControl(summary);
                card.ApplyLanguage(arabic, state.CanMutate, false);
                card.OpenProfileRequested += Card_OpenProfileRequested;
                card.RemoveLinkRequested += Card_RemoveLinkRequested;
                cardsPanel.Controls.Add(card);
            }
            if (state.Status == SelectionStatus.Ready && summaries.Count == 0)
            {
                var empty = CreateLabel(9, false);
                empty.Text = arabic ? "لم يتم العثور على موظفين مرتبطين" : "No linked employees";
                empty.Padding = new Padding(3);
                cardsPanel.Controls.Add(empty);
            }
            if (state.Message != null && summaries.Count != 0)
                _ = LoadPhotosAsync(state.MessageId, summaries);
        }

        private async Task LoadPhotosAsync(string messageId, IReadOnlyList<OutlookEmployeeSummary> summaries)
        {
            foreach (var summary in summaries)
            {
                if (disposed || controller.State.MessageId != messageId) return;
                try
                {
                    var bytes = await api.GetEmployeePhotoAsync(summary.EmployeeId, CancellationToken.None).ConfigureAwait(true);
                    if (disposed || controller.State.MessageId != messageId || bytes == null || bytes.Length == 0) continue;
                    using (var stream = new MemoryStream(bytes))
                    using (var source = Image.FromStream(stream))
                    {
                        var image = new Bitmap(source);
                        foreach (Control control in cardsPanel.Controls)
                        {
                            var card = control as EmployeeCardControl;
                            if (card != null && card.Summary.EmployeeId == summary.EmployeeId)
                            {
                                card.SetPhoto(image);
                                image = null;
                                break;
                            }
                        }
                        if (image != null) image.Dispose();
                    }
                }
                catch (Exception)
                {
                    // A missing photo is not a failed correspondence selection.
                }
            }
        }

        private async void SearchButton_Click(object sender, EventArgs e)
        {
            await SearchAsync().ConfigureAwait(true);
        }

        private async void SearchBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode != Keys.Enter) return;
            e.SuppressKeyPress = true;
            await SearchAsync().ConfigureAwait(true);
        }

        private async Task SearchAsync()
        {
            if (searchCancellation != null) searchCancellation.Cancel();
            if (searchCancellation != null) searchCancellation.Dispose();
            searchCancellation = new CancellationTokenSource();
            var cancellation = searchCancellation;
            var query = searchBox.Text == null ? string.Empty : searchBox.Text.Trim();
            searchStateLabel.Text = arabic ? "جار البحث..." : "Searching...";
            DisposeChildren(searchResultsPanel);
            try
            {
                var results = await api.SearchEmployeesAsync(query, cancellation.Token).ConfigureAwait(true);
                if (cancellation.IsCancellationRequested || disposed) return;
                searchStateLabel.Text = results.Count == 0
                    ? (arabic ? "لا توجد نتائج" : "No employees found")
                    : string.Empty;
                foreach (var summary in results)
                {
                    var card = new EmployeeCardControl(summary);
                    card.ApplyLanguage(arabic, controller.State.CanMutate, controller.State.CanMutate);
                    card.OpenProfileRequested += Card_OpenProfileRequested;
                    card.AddLinkRequested += Card_AddLinkRequested;
                    searchResultsPanel.Controls.Add(card);
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception exception)
            {
                if (!disposed && !cancellation.IsCancellationRequested)
                    searchStateLabel.Text = arabic ? "تعذر البحث: " + exception.Message : "Search failed: " + exception.Message;
            }
        }

        private async void Card_AddLinkRequested(object sender, EventArgs e)
        {
            var card = sender as EmployeeCardControl;
            if (card == null || !controller.State.CanMutate) return;
            card.SetActionBusy(true);
            try
            {
                await controller.AddEmployeeAsync(card.Summary.EmployeeId).ConfigureAwait(true);
                searchStateLabel.Text = arabic ? "تمت إضافة الرابط" : "Link added";
            }
            catch (Exception exception)
            {
                searchStateLabel.Text = arabic ? "تعذر إضافة الرابط: " + exception.Message : "Add link failed: " + exception.Message;
            }
            finally
            {
                card.SetActionBusy(false);
            }
        }
        private async void Card_RemoveLinkRequested(object sender, EventArgs e)
        {
            var card = sender as EmployeeCardControl;
            if (card == null || !controller.State.CanMutate) return;
            card.SetActionBusy(true);
            try
            {
                await controller.DismissEmployeeAsync(card.Summary.EmployeeId).ConfigureAwait(true);
            }
            catch (Exception exception)
            {
                searchStateLabel.Text = arabic ? "تعذر إزالة الرابط: " + exception.Message : "Remove link failed: " + exception.Message;
            }
            finally
            {
                card.SetActionBusy(false);
            }
        }

        private void Card_OpenProfileRequested(object sender, EventArgs e)
        {
            var card = sender as EmployeeCardControl;
            if (card == null) return;
            try
            {
                var uri = api.EmployeeProfileUri(card.Summary.EmployeeId);
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = uri.AbsoluteUri,
                    UseShellExecute = true
                });
            }
            catch (Exception exception)
            {
                stateLabel.Text = arabic ? "تعذر فتح الملف: " + exception.Message : "Profile could not be opened: " + exception.Message;
            }
        }

        private async void PendingRefreshTimer_Tick(object sender, EventArgs e)
        {
            pendingRefreshTimer.Stop();
            if (disposed || !controller.State.RecordingPending) return;
            await controller.RefreshCurrentAsync().ConfigureAwait(true);
        }

        private string StateText(SelectionState value)
        {
            switch (value.Status)
            {
                case SelectionStatus.Loading:
                    return arabic ? "جار تحميل السياق..." : "Loading employee context...";
                case SelectionStatus.Error:
                    return arabic ? "تعذر تحميل السياق: " + value.ErrorMessage : "Could not load context: " + value.ErrorMessage;
                case SelectionStatus.Ready:
                    if (value.RecordingPending)
                        return arabic ? "قيد التسجيل — ستتم إعادة المحاولة" : "Recording pending — will refresh";
                    return arabic ? "تم التحديث" : "Updated";
                default:
                    return arabic ? "حدد رسالة لعرض الموظفين" : "Select a message to see employees";
            }
        }

        private void ApplyLanguage()
        {
            RightToLeft = arabic ? RightToLeft.Yes : RightToLeft.No;
            mailboxLabel.Text = arabic
                ? "البريد المرتبط: " + mailboxAddress
                : "Paired mailbox: " + mailboxAddress;
            searchBox.RightToLeft = arabic ? RightToLeft.Yes : RightToLeft.No;
            searchGroup.Text = arabic ? "بحث يدوي عن موظف" : "Manual employee search";
            searchButton.Text = arabic ? "بحث" : "Search";
            searchStateLabel.Text = string.Empty;
            searchGroup.RightToLeft = RightToLeft;
            searchStateLabel.RightToLeft = RightToLeft;
            searchStateLabel.TextAlign = arabic ? ContentAlignment.MiddleRight : ContentAlignment.MiddleLeft;
            var root = Controls.Count == 0 ? null : Controls[0] as FlowLayoutPanel;
            if (root != null)
            {
                root.RightToLeft = RightToLeft;
                root.FlowDirection = arabic ? FlowDirection.TopDown : FlowDirection.TopDown;
            }
            foreach (Control child in cardsPanel.Controls)
            {
                var card = child as EmployeeCardControl;
                if (card != null) card.ApplyLanguage(arabic, controller.State.CanMutate, false);
            }
            foreach (Control child in searchResultsPanel.Controls)
            {
                var card = child as EmployeeCardControl;
                if (card != null) card.ApplyLanguage(arabic, controller.State.CanMutate, controller.State.CanMutate);
            }
        }

        private static void DisposeChildren(Control parent)
        {
            var children = new List<Control>();
            foreach (Control child in parent.Controls) children.Add(child);
            parent.Controls.Clear();
            foreach (var child in children) child.Dispose();
        }

        private static Label CreateLabel(float size, bool bold)
        {
            return new Label
            {
                AutoSize = true,
                Font = new Font("Segoe UI", size, bold ? FontStyle.Bold : FontStyle.Regular),
                Margin = new Padding(0),
                MaximumSize = new Size(320, 0)
            };
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && !disposed)
            {
                disposed = true;
                pendingRefreshTimer.Stop();
                pendingRefreshTimer.Dispose();
                if (searchCancellation != null) searchCancellation.Cancel();
                if (searchCancellation != null) searchCancellation.Dispose();
                controller.StateChanged -= Controller_StateChanged;
                controller.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
