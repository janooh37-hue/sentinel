namespace Gssg.Outlook
{
    internal static class OutlookBody
    {
        internal static string Prepend(string preparedHtml, string signatureHtml)
        {
            return (preparedHtml ?? string.Empty) + (signatureHtml ?? string.Empty);
        }
    }
}
