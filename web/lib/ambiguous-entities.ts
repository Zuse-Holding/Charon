// Known ambiguous search terms — company names that collide with an
// unrelated, similarly-named company. Mirrors the backend override
// registry (src/entity-validation.ts ENTITY_OVERRIDES) which silently
// forces resolution to one canonical entity and filters out the other's
// domain during source-gathering. That's the right default, but it means
// a user who actually wants the *other* company currently has no way to
// get it. This modal lets them pick up front — the chosen option's
// `subject` is a more specific string than the ambiguous key, so the
// backend/LLM extraction resolves to the right one without needing to
// touch the reject_domains logic per-request.
//
// Add an entry here whenever entity-validation.ts gets a new override
// for a name collision that's genuinely ambiguous to end users (as
// opposed to just a bad-domain problem the backend can silently fix).

export interface AmbiguousOption {
  label: string;       // shown on the button, e.g. "Alan Health Technologies"
  description: string; // one line of disambiguating context
  subject: string;      // the actual string submitted as the research subject
}

export interface AmbiguousEntity {
  match: RegExp;          // matched against the trimmed, lowercased query
  options: AmbiguousOption[];
}

export const AMBIGUOUS_ENTITIES: AmbiguousEntity[] = [
  {
    match: /^alan( health)?$/i,
    options: [
      {
        label: "Alan Health Technologies",
        description: "US digital health company (alanmeds.com)",
        subject: "Alan Health Technologies",
      },
      {
        label: "Alan",
        description: "French health insurance company (alan.com)",
        subject: "Alan SAS French health insurance company alan.com",
      },
    ],
  },
];

export function findAmbiguousMatch(query: string): AmbiguousEntity | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  return AMBIGUOUS_ENTITIES.find((e) => e.match.test(trimmed));
}
