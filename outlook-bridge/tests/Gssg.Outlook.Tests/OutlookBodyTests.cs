using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Gssg.Outlook.Tests
{
    [TestClass]
    public sealed class OutlookBodyTests
    {
        [TestMethod]
        public void PrependPreservesOutlookSignature()
        {
            Assert.AreEqual("<p>Prepared</p><div>Signature</div>",
                OutlookBody.Prepend("<p>Prepared</p>", "<div>Signature</div>"));
        }

        [TestMethod]
        public void DetectorUsesCanonicalBoundariesAndDeduplicates()
        {
            CollectionAssert.AreEqual(
                new[] { "G1234", "G3082" },
                GNumberDetector.Detect("G1234 and g3082 and G1234; AG9999X"));
        }
    }
}
