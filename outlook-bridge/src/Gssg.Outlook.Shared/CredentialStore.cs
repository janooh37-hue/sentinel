using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Gssg.Outlook
{
    internal sealed class CredentialStore
    {
        internal const string Target = "GSSG Manager Outlook Bridge";
        private const uint GenericCredential = 1;
        private const uint PersistLocalMachine = 2;
        private const int NotFound = 1168;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct NativeCredential
        {
            internal uint Flags;
            internal uint Type;
            [MarshalAs(UnmanagedType.LPWStr)] internal string TargetName;
            [MarshalAs(UnmanagedType.LPWStr)] internal string Comment;
            internal System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
            internal uint CredentialBlobSize;
            internal IntPtr CredentialBlob;
            internal uint Persist;
            internal uint AttributeCount;
            internal IntPtr Attributes;
            [MarshalAs(UnmanagedType.LPWStr)] internal string TargetAlias;
            [MarshalAs(UnmanagedType.LPWStr)] internal string UserName;
        }

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredWrite(ref NativeCredential credential, uint flags);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool CredDelete(string target, uint type, uint flags);

        [DllImport("advapi32.dll")]
        private static extern void CredFree(IntPtr credential);

        internal string Read()
        {
            IntPtr pointer;
            if (!CredRead(Target, GenericCredential, 0, out pointer))
            {
                var error = Marshal.GetLastWin32Error();
                if (error == NotFound) return null;
                throw new Win32Exception(error, "Unable to read the Outlook bridge credential.");
            }

            try
            {
                var native = (NativeCredential)Marshal.PtrToStructure(pointer, typeof(NativeCredential));
                if (native.CredentialBlob == IntPtr.Zero || native.CredentialBlobSize == 0) return null;
                var bytes = new byte[native.CredentialBlobSize];
                Marshal.Copy(native.CredentialBlob, bytes, 0, bytes.Length);
                return Encoding.UTF8.GetString(bytes);
            }
            finally
            {
                CredFree(pointer);
            }
        }

        internal void Write(string credential)
        {
            if (string.IsNullOrWhiteSpace(credential))
                throw new ArgumentException("Credential must not be empty.", nameof(credential));

            var bytes = Encoding.UTF8.GetBytes(credential);
            var blob = Marshal.AllocHGlobal(bytes.Length);
            var target = Marshal.StringToCoTaskMemUni(Target);
            var user = Marshal.StringToCoTaskMemUni(Environment.UserName);
            try
            {
                Marshal.Copy(bytes, 0, blob, bytes.Length);
                var native = new NativeCredential
                {
                    Type = GenericCredential,
                    TargetName = Target,
                    UserName = Environment.UserName,
                    CredentialBlob = blob,
                    CredentialBlobSize = (uint)bytes.Length,
                    Persist = PersistLocalMachine
                };
                if (!CredWrite(ref native, 0))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to save the Outlook bridge credential.");
            }
            finally
            {
                Marshal.FreeHGlobal(blob);
                Marshal.FreeCoTaskMem(target);
                Marshal.FreeCoTaskMem(user);
            }
        }

        internal void Delete()
        {
            if (!CredDelete(Target, GenericCredential, 0))
            {
                var error = Marshal.GetLastWin32Error();
                if (error != NotFound)
                    throw new Win32Exception(error, "Unable to remove the Outlook bridge credential.");
            }
        }
    }
}
