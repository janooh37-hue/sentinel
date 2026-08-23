using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Gssg.Outlook
{
    internal static class GNumberDetector
    {
        private static readonly Regex Pattern = new Regex(
            @"\bG\d{3,4}\b",
            RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        internal static IReadOnlyList<string> Detect(string text)
        {
            var result = new List<string>();
            if (string.IsNullOrEmpty(text)) return result;

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (Match match in Pattern.Matches(text))
            {
                var value = match.Value.ToUpperInvariant();
                if (seen.Add(value)) result.Add(value);
            }
            return result;
        }
    }
}
