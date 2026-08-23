using System;
using System.Collections.Generic;

namespace Gssg.Outlook
{
    internal static class FailureCodeMessages
    {
        private static readonly IDictionary<string, string> English = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "CLASSIC_OUTLOOK_REQUIRED", "Classic Outlook is required. New Outlook alone cannot handle this action." },
            { "MAILBOX_NOT_FOUND", "No active Outlook mailbox was found." },
            { "MAILBOX_MISMATCH", "The active Outlook mailbox does not match the paired mailbox." },
            { "PAIRING_REQUIRED", "Pair the Outlook bridge before using this action." },
            { "HANDOFF_EXPIRED", "The Outlook handoff expired. Try again." },
            { "ATTACHMENT_FAILURE", "An Outlook attachment could not be downloaded." },
            { "MESSAGE_NOT_FOUND", "The Outlook message was not found in the paired mailbox." },
            { "COMPLETION_RETRY_REQUIRED", "The Outlook action completed, but Sentinel could not record completion. It will retry status only." },
            { "HANDOFF_INVALID", "The Outlook handoff was not valid." }
        };

        private static readonly IDictionary<string, string> Arabic = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "CLASSIC_OUTLOOK_REQUIRED", "يتطلب هذا الإجراء Outlook الكلاسيكي. لا يمكن لـ Outlook الجديد وحده إتمامه." },
            { "MAILBOX_NOT_FOUND", "لم يتم العثور على صندوق بريد Outlook نشط." },
            { "MAILBOX_MISMATCH", "صندوق بريد Outlook النشط لا يطابق الصندوق المقترن." },
            { "PAIRING_REQUIRED", "قم بإقران جسر Outlook قبل استخدام هذا الإجراء." },
            { "HANDOFF_EXPIRED", "انتهت صلاحية تسليم Outlook. حاول مرة أخرى." },
            { "ATTACHMENT_FAILURE", "تعذر تنزيل مرفق Outlook." },
            { "MESSAGE_NOT_FOUND", "لم يتم العثور على رسالة Outlook في صندوق البريد المقترن." },
            { "COMPLETION_RETRY_REQUIRED", "اكتمل إجراء Outlook، لكن تعذر تسجيله في Sentinel. ستتم إعادة محاولة الحالة فقط." },
            { "HANDOFF_INVALID", "تسليم Outlook غير صالح." }
        };

        internal static string Get(string code, bool arabic)
        {
            if (string.IsNullOrWhiteSpace(code)) return null;
            string message;
            return (arabic ? Arabic : English).TryGetValue(code, out message) ? message : null;
        }
    }
}
