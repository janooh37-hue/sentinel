using System;
using System.Drawing;
using System.Windows.Forms;
using Gssg.Outlook;

namespace Gssg.Outlook.AddIn
{
    internal sealed class EmployeeCardControl : UserControl
    {
        private readonly PictureBox photo;
        private readonly Label nameLabel;
        private readonly Label numberLabel;
        private readonly Label positionLabel;
        private readonly Label statusLabel;
        private readonly Button openButton;
        private readonly Button removeButton;
        private readonly Button addButton;
        private bool arabic;
        private OutlookEmployeeSummary summary;

        internal EmployeeCardControl(OutlookEmployeeSummary summary)
        {
            this.summary = summary ?? throw new ArgumentNullException(nameof(summary));
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            BackColor = Color.White;
            BorderStyle = BorderStyle.FixedSingle;
            Margin = new Padding(3);
            Padding = new Padding(6);
            MinimumSize = new Size(270, 88);
            Dock = DockStyle.Top;

            photo = new PictureBox
            {
                Size = new Size(56, 56),
                SizeMode = PictureBoxSizeMode.Zoom,
                BackColor = Color.Gainsboro,
                Margin = new Padding(0, 0, 8, 0)
            };
            nameLabel = CreateLabel(10, true);
            numberLabel = CreateLabel(9, false);
            positionLabel = CreateLabel(9, false);
            statusLabel = CreateLabel(9, false);

            var details = new TableLayoutPanel
            {
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                ColumnCount = 1,
                RowCount = 4,
                Dock = DockStyle.Fill,
                Margin = new Padding(0)
            };
            details.Controls.Add(nameLabel, 0, 0);
            details.Controls.Add(numberLabel, 0, 1);
            details.Controls.Add(positionLabel, 0, 2);
            details.Controls.Add(statusLabel, 0, 3);

            var identity = new TableLayoutPanel
            {
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                ColumnCount = 2,
                RowCount = 1,
                Dock = DockStyle.Top,
                Margin = new Padding(0)
            };
            identity.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            identity.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            identity.Controls.Add(photo, 0, 0);
            identity.Controls.Add(details, 1, 0);

            openButton = new Button { AutoSize = true, Margin = new Padding(0, 5, 4, 0) };
            removeButton = new Button { AutoSize = true, Margin = new Padding(0, 5, 4, 0) };
            addButton = new Button { AutoSize = true, Margin = new Padding(0, 5, 4, 0) };
            openButton.Click += delegate { OpenProfileRequested?.Invoke(this, EventArgs.Empty); };
            removeButton.Click += delegate { RemoveLinkRequested?.Invoke(this, EventArgs.Empty); };
            addButton.Click += delegate { AddLinkRequested?.Invoke(this, EventArgs.Empty); };

            var actions = new FlowLayoutPanel
            {
                AutoSize = true,
                Dock = DockStyle.Top,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Margin = new Padding(0),
                Padding = new Padding(0)
            };
            actions.Controls.Add(openButton);
            actions.Controls.Add(removeButton);
            actions.Controls.Add(addButton);

            Controls.Add(actions);
            Controls.Add(identity);
            ApplyLanguage(false, true, false);
        }

        internal OutlookEmployeeSummary Summary { get { return summary; } }
        internal event EventHandler OpenProfileRequested;
        internal event EventHandler RemoveLinkRequested;
        internal event EventHandler AddLinkRequested;

        internal void ApplyLanguage(bool useArabic, bool canMutate, bool showAdd)
        {
            arabic = useArabic;
            RightToLeft = useArabic ? RightToLeft.Yes : RightToLeft.No;
            nameLabel.Text = Choose(summary.NameEn, summary.NameAr);
            numberLabel.Text = useArabic ? "الرقم الوظيفي: " + summary.EmployeeId : "G-number: " + summary.EmployeeId;
            positionLabel.Text = useArabic ? "المسمى الوظيفي: " + (summary.Position ?? "غير محدد") : "Position: " + (summary.Position ?? "Not specified");
            statusLabel.Text = useArabic ? "الحالة: " + (summary.Status ?? "غير معروف") : "Status: " + (summary.Status ?? "Unknown");
            nameLabel.TextAlign = useArabic ? ContentAlignment.MiddleRight : ContentAlignment.MiddleLeft;
            numberLabel.TextAlign = nameLabel.TextAlign;
            positionLabel.TextAlign = nameLabel.TextAlign;
            statusLabel.TextAlign = nameLabel.TextAlign;
            openButton.Text = useArabic ? "فتح الملف" : "Open profile";
            removeButton.Text = useArabic ? "إزالة الرابط" : "Remove link";
            addButton.Text = useArabic ? "إضافة الرابط" : "Add link";
            removeButton.Visible = canMutate;
            addButton.Visible = showAdd;
            var actions = openButton.Parent as FlowLayoutPanel;
            if (actions != null) actions.FlowDirection = FlowDirection.LeftToRight;
        }

        internal void SetPhoto(Image image)
        {
            var old = photo.Image;
            photo.Image = image;
            if (old != null) old.Dispose();
        }

        internal void SetActionBusy(bool busy)
        {
            openButton.Enabled = !busy;
            removeButton.Enabled = !busy;
            addButton.Enabled = !busy;
        }

        internal void SetPending(bool pending)
        {
            summary.RecordingPending = pending;
            statusLabel.Text = pending
                ? (arabic ? "الحالة: قيد التسجيل" : "Status: Recording pending")
                : (arabic ? "الحالة: " + (summary.Status ?? "غير معروف") : "Status: " + (summary.Status ?? "Unknown"));
        }

        private string Choose(string english, string arabicText)
        {
            if (arabic && !string.IsNullOrWhiteSpace(arabicText)) return arabicText;
            return english ?? arabicText ?? string.Empty;
        }

        private static Label CreateLabel(float size, bool bold)
        {
            return new Label
            {
                AutoSize = true,
                Font = new Font("Segoe UI", size, bold ? FontStyle.Bold : FontStyle.Regular),
                Margin = new Padding(0),
                MaximumSize = new Size(190, 0)
            };
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && photo != null && photo.Image != null)
            {
                photo.Image.Dispose();
                photo.Image = null;
            }
            base.Dispose(disposing);
        }
    }
}
