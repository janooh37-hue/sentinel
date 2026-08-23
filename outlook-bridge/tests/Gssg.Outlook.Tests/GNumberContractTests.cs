using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using Gssg.Outlook;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Gssg.Outlook.Tests
{
    [TestClass]
    public sealed class GNumberContractTests
    {
        [TestMethod]
        public void DetectorMatchesEverySharedFixture()
        {
            var fixturePath = FindFixture();
            Assert.IsNotNull(fixturePath, "shared/contracts/gnumber_cases.json was not found");
            Fixture fixture;
            var serializer = new DataContractJsonSerializer(typeof(Fixture));
            using (var stream = File.OpenRead(fixturePath))
                fixture = (Fixture)serializer.ReadObject(stream);

            AssertCases(fixture.Valid);
            AssertCases(fixture.Invalid);
        }

        private static void AssertCases(IReadOnlyList<GNumberCase> cases)
        {
            foreach (var testCase in cases)
            {
                var actual = GNumberDetector.Detect(testCase.Text);
                CollectionAssert.AreEqual(testCase.Matches, new List<string>(actual), testCase.Text);
            }
        }

        private static string FindFixture()
        {
            var directory = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            while (directory != null)
            {
                var candidate = Path.Combine(directory.FullName, "shared", "contracts", "gnumber_cases.json");
                if (File.Exists(candidate)) return candidate;
                directory = directory.Parent;
            }
            return null;
        }

        [DataContract]
        private sealed class Fixture
        {
            [DataMember(Name = "valid")] internal List<GNumberCase> Valid;
            [DataMember(Name = "invalid")] internal List<GNumberCase> Invalid;
        }

        [DataContract]
        private sealed class GNumberCase
        {
            [DataMember(Name = "text")] internal string Text;
            [DataMember(Name = "matches")] internal List<string> Matches;
        }
    }
}
