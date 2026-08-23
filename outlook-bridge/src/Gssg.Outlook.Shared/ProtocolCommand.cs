using System;

namespace Gssg.Outlook
{
    internal enum CommandKind
    {
        Pair,
        Compose,
        Open
    }

    internal sealed class ProtocolException : Exception
    {
        internal ProtocolException(string message) : base(message) { }
    }

    internal sealed class ProtocolCommand
    {
        private ProtocolCommand(CommandKind kind, string token)
        {
            Kind = kind;
            Token = token;
        }

        internal CommandKind Kind { get; private set; }
        internal string Token { get; private set; }

        internal static ProtocolCommand Parse(string value)
        {
            Uri uri;
            if (string.IsNullOrWhiteSpace(value) ||
                value.IndexOf('?') >= 0 || value.IndexOf('#') >= 0 ||
                !Uri.TryCreate(value, UriKind.Absolute, out uri) ||
                !string.Equals(uri.Scheme, "gssg-outlook", StringComparison.OrdinalIgnoreCase) ||
                uri.Query.Length != 0 || uri.Fragment.Length != 0 ||
                string.IsNullOrEmpty(uri.Host))
            {
                throw new ProtocolException("Invalid Outlook bridge URI.");
            }

            CommandKind kind;
            switch (uri.Host.ToLowerInvariant())
            {
                case "pair": kind = CommandKind.Pair; break;
                case "compose": kind = CommandKind.Compose; break;
                case "open": kind = CommandKind.Open; break;
                default: throw new ProtocolException("Unknown Outlook bridge command.");
            }

            var path = uri.AbsolutePath;
            if (path.Length < 2 || path[0] != '/' || path[path.Length - 1] == '/' || path.IndexOf('/', 1) >= 0)
                throw new ProtocolException("Invalid Outlook bridge token.");

            string token;
            try
            {
                token = Uri.UnescapeDataString(path.Substring(1));
            }
            catch (UriFormatException)
            {
                throw new ProtocolException("Invalid Outlook bridge token.");
            }

            if (token.Length == 0 || token.IndexOf('/') >= 0 || token.IndexOf('\\') >= 0 ||
                token == "." || token == ".." || token.IndexOf('\0') >= 0)
            {
                throw new ProtocolException("Invalid Outlook bridge token.");
            }

            return new ProtocolCommand(kind, token);
        }
    }
}
