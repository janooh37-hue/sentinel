using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Gssg.Outlook.Tests
{
    [TestClass]
    public sealed class HandoffPayloadTests
    {
        [TestMethod]
        public void OpenPayloadCarriesExactOutlookLocation()
        {
            var payload = new HandoffPayload
            {
                LedgerEntryId = 7,
                OutlookStoreId = "store-1",
                OutlookEntryId = "entry-1",
                InternetMessageId = "<message-1>"
            };

            Assert.AreEqual(7, payload.LedgerEntryId);
            Assert.AreEqual("store-1", payload.OutlookStoreId);
            Assert.AreEqual("entry-1", payload.OutlookEntryId);
            Assert.AreEqual("<message-1>", payload.InternetMessageId);
        }
    }
}
