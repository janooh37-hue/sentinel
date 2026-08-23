using System;
using System.ComponentModel;
using Microsoft.Office.Tools;
using Microsoft.Office.Tools.Outlook;
using OfficeOutlook = Microsoft.Office.Interop.Outlook;

namespace Gssg.Outlook.AddIn
{
    [Microsoft.VisualStudio.Tools.Applications.Runtime.StartupObjectAttribute(0)]
    [System.Security.Permissions.PermissionSet(System.Security.Permissions.SecurityAction.Demand, Name = "FullTrust")]
    public sealed partial class ThisAddIn : OutlookAddInBase
    {
        internal CustomTaskPaneCollection CustomTaskPanes;
        internal OfficeOutlook.Application Application;

        public ThisAddIn(Factory factory, IServiceProvider serviceProvider)
            : base(factory, serviceProvider, "AddIn", "ThisAddIn")
        {
            Globals.Factory = factory;
        }

        protected override void Initialize()
        {
            base.Initialize();
            Application = GetHostItem<OfficeOutlook.Application>(typeof(OfficeOutlook.Application), "Application");
            Globals.ThisAddIn = this;
            System.Windows.Forms.Application.EnableVisualStyles();
            InitializeControls();
        }

        protected override void FinishInitialization()
        {
            InternalStartup();
            OnStartup();
        }

        private void InternalStartup()
        {
        }

        private void InitializeControls()
        {
            CustomTaskPanes = Globals.Factory.CreateCustomTaskPaneCollection(
                null,
                null,
                "CustomTaskPanes",
                "CustomTaskPanes",
                this);
        }

        protected override void OnShutdown()
        {
            ShutdownBridge();
            if (CustomTaskPanes != null) CustomTaskPanes.Dispose();
            base.OnShutdown();
        }
    }

    internal static class Globals
    {
        private static ThisAddIn thisAddIn;
        private static Factory factory;

        internal static ThisAddIn ThisAddIn
        {
            get { return thisAddIn; }
            set
            {
                if (thisAddIn != null) throw new NotSupportedException();
                thisAddIn = value;
            }
        }

        internal static Factory Factory
        {
            get { return factory; }
            set
            {
                if (factory != null) throw new NotSupportedException();
                factory = value;
            }
        }
    }
}
