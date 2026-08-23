using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Gssg.Outlook;
using Gssg.Outlook.AddIn;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Gssg.Outlook.Tests
{
    [TestClass]
    public sealed class SelectionControllerTests
    {
        [TestMethod]
        public async Task StaleSelectionCannotReplaceCurrentCards()
        {
            var firstResponse = new TaskCompletionSource<OutlookSelectionResponse>();
            var secondResponse = new TaskCompletionSource<OutlookSelectionResponse>();
            var api = new DeferredSelectionApi(firstResponse, secondResponse);
            using (var controller = new SelectionController(api))
            {
                var message1 = Message("message-1", "entry-1");
                var message2 = Message("message-2", "entry-2");
                var first = controller.SelectAsync(message1);
                var second = controller.SelectAsync(message2);
                secondResponse.SetResult(Ready("G200"));
                firstResponse.SetResult(Ready("G100"));
                await Task.WhenAll(first, second);
                Assert.AreEqual(message2.MessageId, controller.State.MessageId);
                Assert.AreEqual("G200", controller.State.Employees[0].EmployeeId);
            }
        }

        [TestMethod]
        public async Task PendingSelectionDisablesManualMutation()
        {
            var response = new TaskCompletionSource<OutlookSelectionResponse>();
            using (var controller = new SelectionController(new DeferredSelectionApi(response, response)))
            {
                var selection = controller.SelectAsync(Message("pending", "entry"));
                response.SetResult(new OutlookSelectionResponse
                {
                    Indexed = false,
                    RecordingPending = true,
                    Employees = new List<OutlookEmployeeSummary>()
                });
                await selection;
                Assert.IsTrue(controller.State.RecordingPending);
                Assert.IsFalse(controller.State.CanMutate);
                Assert.IsFalse(await controller.AddEmployeeAsync("G123"));
                Assert.IsFalse(await controller.DismissEmployeeAsync("G123"));
            }
        }

        [TestMethod]
        public async Task IndexedSelectionAllowsMutationAndRefreshes()
        {
            var first = new TaskCompletionSource<OutlookSelectionResponse>();
            var refresh = new TaskCompletionSource<OutlookSelectionResponse>();
            var api = new MutationSelectionApi(first, refresh);
            using (var controller = new SelectionController(api))
            {
                var selection = controller.SelectAsync(Message("indexed", "entry"));
                first.SetResult(new OutlookSelectionResponse
                {
                    Indexed = true,
                    EntryId = 44,
                    Employees = new List<OutlookEmployeeSummary>()
                });
                await selection;
                var add = controller.AddEmployeeAsync("G321");
                refresh.SetResult(new OutlookSelectionResponse
                {
                    Indexed = true,
                    EntryId = 44,
                    Employees = new List<OutlookEmployeeSummary>
                    {
                        new OutlookEmployeeSummary { EmployeeId = "G321", NameEn = "Employee", Status = "Active" }
                    }
                });
                Assert.IsTrue(await add);
                Assert.AreEqual("G321", controller.State.Employees[0].EmployeeId);
                Assert.AreEqual(44, api.LastLinkedEntryId);
            }
        }

        private static OutlookMessage Message(string messageId, string entryId)
        {
            return new OutlookMessage(messageId, entryId, "store", "Subject G123", "Body", "mailbox@example.test");
        }

        private static OutlookSelectionResponse Ready(string employeeId)
        {
            return new OutlookSelectionResponse
            {
                Indexed = true,
                EntryId = 7,
                Employees = new List<OutlookEmployeeSummary>
                {
                    new OutlookEmployeeSummary { EmployeeId = employeeId, NameEn = employeeId, Status = "Active" }
                }
            };
        }

        private class DeferredSelectionApi : ISelectionApi
        {
            private readonly TaskCompletionSource<OutlookSelectionResponse> first;
            private readonly TaskCompletionSource<OutlookSelectionResponse> second;
            private int calls;

            internal DeferredSelectionApi(
                TaskCompletionSource<OutlookSelectionResponse> first,
                TaskCompletionSource<OutlookSelectionResponse> second)
            {
                this.first = first;
                this.second = second;
            }

            public Task<OutlookSelectionResponse> ResolveSelectionAsync(SelectionRequest request, CancellationToken cancellationToken)
            {
                return Interlocked.Increment(ref calls) == 1 ? first.Task : second.Task;
            }

            public Task<IReadOnlyList<OutlookEmployeeSummary>> SearchEmployeesAsync(string query, CancellationToken cancellationToken)
            {
                return Task.FromResult<IReadOnlyList<OutlookEmployeeSummary>>(new List<OutlookEmployeeSummary>());
            }

            public virtual Task LinkEmployeeAsync(int entryId, string employeeId, CancellationToken cancellationToken) { return Task.CompletedTask; }
            public virtual Task DismissEmployeeAsync(int entryId, string employeeId, CancellationToken cancellationToken) { return Task.CompletedTask; }
            public virtual Task<byte[]> GetEmployeePhotoAsync(string employeeId, CancellationToken cancellationToken) { return Task.FromResult(new byte[0]); }
            public virtual Uri EmployeeProfileUri(string employeeId) { return new Uri("https://sentinel.example/employees/" + employeeId); }
        }

        private sealed class MutationSelectionApi : DeferredSelectionApi
        {
            internal int LastLinkedEntryId { get; private set; }

            internal MutationSelectionApi(
                TaskCompletionSource<OutlookSelectionResponse> first,
                TaskCompletionSource<OutlookSelectionResponse> refresh)
                : base(first, refresh)
            {
            }

            public override Task LinkEmployeeAsync(int entryId, string employeeId, CancellationToken cancellationToken)
            {
                LastLinkedEntryId = entryId;
                return Task.CompletedTask;
            }
        }
    }
}
