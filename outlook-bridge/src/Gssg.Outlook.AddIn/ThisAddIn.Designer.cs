using System;
using OfficeOutlook = Microsoft.Office.Interop.Outlook;
using Microsoft.Office.Tools.Outlook;

namespace Gssg.Outlook.AddIn
{
    [Microsoft.VisualStudio.Tools.Applications.Runtime.StartupObjectAttribute(0)]
    [System.Security.Permissions.PermissionSet(System.Security.Permissions.SecurityAction.Demand, Name = "FullTrust")]
    public sealed partial class ThisAddIn : OutlookAddInBase
    {
        internal OfficeOutlook.Application Application;
        internal Microsoft.Office.Tools.CustomTaskPaneCollection CustomTaskPanes;
        public ThisAddIn(Microsoft.Office.Tools.Outlook.Factory factory, IServiceProvider serviceProvider)
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
            Startup += ThisAddIn_Startup;
            Shutdown += ThisAddIn_Shutdown;
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
        private static Microsoft.Office.Tools.Outlook.Factory factory;

        internal static ThisAddIn ThisAddIn
        {
            get { return thisAddIn; }
            set
            {
                if (thisAddIn != null) throw new NotSupportedException();
                thisAddIn = value;
            }
        }

        internal static Microsoft.Office.Tools.Outlook.Factory Factory
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
