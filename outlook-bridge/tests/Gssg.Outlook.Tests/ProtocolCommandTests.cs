using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Gssg.Outlook.Tests
{
    [TestClass]
    public sealed class ProtocolCommandTests
    {
        [TestMethod]
        public void ParseRejectsOriginOverride()
        {
            Assert.ThrowsException<ProtocolException>(() =>
                ProtocolCommand.Parse("gssg-outlook://compose/token?origin=https://evil.example"));
        }

        [TestMethod]
        public void ParseAcceptsOnlySingleTokenPath()
        {
            var command = ProtocolCommand.Parse("gssg-outlook://open/one-token");
            Assert.AreEqual(CommandKind.Open, command.Kind);
            Assert.AreEqual("one-token", command.Token);
        }

        [TestMethod]
        [DataRow("http://compose/token")]
        [DataRow("gssg-outlook://other/token")]
        [DataRow("gssg-outlook://compose/a/b")]
        [DataRow("gssg-outlook://compose/")]
        [DataRow("gssg-outlook://compose/token#fragment")]
        [DataRow("gssg-outlook://compose/token/")]
        [DataRow("gssg-outlook://compose/token?")]
        public void ParseRejectsMalformedCommands(string value)
        {
            Assert.ThrowsException<ProtocolException>(() => ProtocolCommand.Parse(value));
        }
    }
}
