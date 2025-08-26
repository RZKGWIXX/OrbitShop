Patch contents
- public/style.css  -> CSS patch to prevent bottom nav from covering Buy buttons on small screens.

How to apply
1) Make a backup of your current public/style.css:
   cp public/style.css public/style.css.bak
2) Append the contents of this file to the end of your public/style.css:
   cat public/style.css >> public/style.css.bak  # optional backup step
   cat public/style.css  # inspect
   (Then) echo '...contents...' >> public/style.css  OR copy the file over.
   Example (Linux):
     cat public/style.css >> public/style.css.bak
     cat public/style.css.patch >> public/style.css  # if you placed this patch file
3) Restart your dev server (if needed) and test on mobile.

If you'd like, I can instead send a full rebuilt archive of the entire project with this fix merged in — tell me and I'll generate it.
