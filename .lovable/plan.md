
Goal: fix the “Invalid login credentials” loop without resetting data again.

What I found:
- Backend auth is working: the logs show signup succeeded and the app immediately logged in that same new user successfully.
- So this is not a broken database/auth backend issue.
- The weak spots are in the app UX/flow:
  1. signup assumes instant login and has no confirm-password protection,
  2. login gives only the raw error,
  3. there is no password recovery path,
  4. auth guarding is still client-side and can be cleaned up.

Plan

1. Harden signup/login UX
- Add `confirm password` on `/signup`
- Normalize email before submit (`trim().toLowerCase()`)
- Keep password exactly as typed
- Add show/hide password toggle on signup + login
- Improve error copy for invalid credentials so users get a clearer message

2. Add recovery flow
- Add “Forgot password?” link on `/login`
- Create `/reset-password-request` page to send reset email
- Create `/reset-password` page to set a new password after recovery link
- Wire it through the existing backend auth

3. Make signup flow robust
- Update `signUp` handling so it does not blindly assume auto-login
- If signup returns a live session: continue to dashboard
- If signup requires confirmation: show a success message with next steps instead of trying to log in again
- This removes the fragile “auto-confirm is on” assumption in the current code

4. Tighten route auth behavior
- Replace the current component-level redirect pattern in `_authenticated.tsx` with proper route guard logic
- Prevent edge cases where the app sits in loading/redirect states awkwardly

5. Verify end-to-end
- Fresh signup with a new email
- Sign out → sign back in with same password
- Trigger forgot-password → reset password → log in with new password
- Confirm super-admin bootstrap still works for the first fresh user

Files to update
- `src/hooks/useAuth.tsx`
- `src/routes/login.tsx`
- `src/routes/signup.tsx`
- `src/routes/_authenticated.tsx`
- new public route for reset request
- new public route for reset password

Expected result
- No more dead-end when a user cannot sign in
- Much clearer auth UX
- Safe recovery path instead of wiping the database
- More reliable protected-route behavior
