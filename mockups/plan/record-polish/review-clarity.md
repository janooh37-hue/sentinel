VERDICT: CONFIRMED

No blocking issues remain in the clarity area.

Every clarity item from the previous review is now either applied in the revised plan or rejected with evidence that holds up against the code. These checks were re-done:

- **Clarity 1 (Back after J/K):** the rejection holds. On mount, `BooksPage.tsx:207` seeds `deepLinkOpenRef` from `?open=`. When the page is not on desktop (`!isDesktop`), or the row is not in the loaded list, `:213-214` then replaces the URL with `/books/${target}`. So returning with `open=<id>` would bounce the user straight back into the record. The plan keeps the intended behaviour another way: 3g strips `open` from `from`, J/K use `replace` and forward state, and the list receives `focusBookId` + `scrollY` in history state.
- **Clarity 2 (scroll restore):** the plan carries the scroll position in history state, as `RecordNavState.scrollY` read back by `useListReturnFocus`. This matches the existing idiom: `ApprovalsPage.tsx:53-56` and `:301-322` already use `{scrollY, focusBookId}`.
- **Clarity 6 (filter helpers):** the rejection holds. `isAnyFilterActive` exists as a local const at `BooksFilterBar.tsx:63`, used at `:438`. 3h unifies it with BP's `hasFilters` into `hasActiveFilters`.
- **Clarity 10 (`papersN`):** the rejection holds. The row paper-count chip already has `title={t('books.pane.papers', {count})}` (`RecordsList.tsx:171`). The plan adds the plural forms and reuses the key on the phone card.
- **Clarity 14 (AccountMenu):** the rejection holds. `AccountMenu.tsx:94` already has `const { user } = useAuth()`. S5 adds only `useCapabilities`.
- **`wordActive` editor name:** the `{{name}}` source exists. `BookEditSessionRead.user_name` is defined at `be/schemas/book.py:226` and exposed through `BookRead.edit_session` (`:374`).

REVIEW READY
