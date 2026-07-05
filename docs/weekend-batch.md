# Weekend Batch — Priority Order for July 4th

## 1. Favicon (verify or re-add)
File included: `web/app/favicon.svg`
Copy this file into your project at that exact path.

Then check `web/app/layout.tsx` has this in the metadata export:
```typescript
export const metadata: Metadata = {
  title: "Charon — Business Intelligence",
  description: "...",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};
```

If `icons` is missing, add it. Save, push.

---

## 2. Mobile Drawer Scroll + Logout Button

Open `web/components/Topbar.tsx`. Find the mobile drawer section — look for
`.drawer` in the JSX, something like:

```tsx
<div className={styles.drawer} onClick={e => e.stopPropagation()}>
  <div className={styles.drawerHeader}>...</div>
  {[
    { label: "Dashboard", href: "/app", icon: "◈" },
    ...
  ].map(item => (
    <button key={item.href} className={styles.drawerItem} ...>
      ...
    </button>
  ))}
</div>
```

After the `.map()` closes (after the last drawer item renders), add:

```tsx
<div className={styles.drawerDivider} />
<button
  className={`${styles.drawerItem} ${styles.drawerItemDanger}`}
  onClick={() => { setMenuOpen(false); router.push("/logout"); }}
>
  <span className={styles.drawerIcon}>⏻</span>
  Sign Out
</button>
```

Then open `web/components/Topbar.module.css`, find `.drawer {` and add these
two lines inside it:
```css
overflow-y: auto;
max-height: 100vh;
```

Add these new classes anywhere in the file:
```css
.drawerDivider { height: 1px; background: var(--border); margin: 8px 0; }
.drawerItemDanger { color: #ff6b6b; }
.drawerItemDanger:hover { background: rgba(255,107,107,0.08); }
```

---

## 3. Entity Normalization — Broader Pattern (not just Warner Bros.)

Open `src/agents/entity-extraction/index.ts`. Find the `normalizeName`
function. Add this map ABOVE the function:

```typescript
// Common informal-name → current-corporate-entity mappings.
// Add more as you discover mismatches during testing.
const PARENT_COMPANY_MAP: Record<string, string> = {
  "warner brothers": "Warner Bros. Discovery",
  "warner bros": "Warner Bros. Discovery",
  "warner bros.": "Warner Bros. Discovery",
  "instagram": "Meta",
  "whatsapp": "Meta",
  "youtube": "Google",
  "linkedin": "Microsoft",
  "github": "Microsoft",
  "activision": "Microsoft",
  "activision blizzard": "Microsoft",
  "20th century fox": "Disney",
  "20th century studios": "Disney",
  "abc": "Disney",
  "espn": "Disney",
  "marvel": "Disney",
  "pixar": "Disney",
  "lucasfilm": "Disney",
  "hulu": "Disney",
  "twitter": "X",
  "cnn": "Warner Bros. Discovery",
  "hbo": "Warner Bros. Discovery",
  "discovery channel": "Warner Bros. Discovery",
};
```

Inside `normalizeName()`, find the line that currently returns the final
value (something like `return n || null;` or `return n;`) and change it to
check the map FIRST:

```typescript
function normalizeName(name: string): string | null {
  let n = name.replace(/\s*\([^)]+\)\s*$/, "").trim();
  n = n.replace(/,?\s*(Inc\.|LLC|Ltd\.|Corp\.|Co\.|Group)\.?$/i, "").trim();

  // Check parent company mapping BEFORE other filters
  const lower = n.toLowerCase();
  if (PARENT_COMPANY_MAP[lower]) return PARENT_COMPANY_MAP[lower];

  const lastWord = n.split(" ").pop()?.toLowerCase() ?? "";
  if (PRODUCT_CATEGORY_WORDS.has(lastWord) && n.split(" ").length <= 3) return null;
  return n || null;
}
```

This is additive — won't break existing normalization, just adds a lookup
step before the existing logic runs.

---

## 4. Deep Dive Centered Modal (restore preferred UI)

This one needs the actual file you liked from a few days ago. If you still
have an old zip from before the DeepDiveProgress rewrites, pull
`DeepDiveProgress.tsx` and `DeepDiveProgress.module.css` from that version
and share them — I'll add the nav warning + Supabase save on top without
changing the visual layout, same approach as last time.

If you don't have an old zip, describe what you remember: was it a centered
overlay/modal that dimmed the background, with the progress bar and section
list in the middle of the screen? That'll help me rebuild it accurately.

---

## Testing checklist for tomorrow

- [ ] Favicon shows in browser tab
- [ ] Mobile: hamburger drawer scrolls if content overflows
- [ ] Mobile: Sign Out button visible and working in drawer
- [ ] Search "Warner Brothers" — should now normalize to "Warner Bros. Discovery" in new KG entries
- [ ] Cross-entity query still works (regression check)
- [ ] Watch button glow still works (regression check)
