# Decision records

## ADR vs decision record

| | ADR ([adr/](../adr/README.md)) | Decision record (here) |
|---|---|---|
| Lifetime | Long-lived | Bounded to a project, release or product question |
| Subject | Architecture / engineering policy | e.g. a release go/no-go, a scope cut, a vendor choice for one feature, a gate outcome |
| Change | Superseded by a new ADR | Closed or superseded when its scope ends |

If a decision would constrain future work beyond its own scope, write an ADR instead.

## Conventions

- File name: `DEC-NNN-short-kebab-title.md`.
- Record real decisions only, when they are made. Do not back-fill invented history.

## Minimum fields

```markdown
# DEC-NNN: <Title>

- ID: DEC-NNN
- Date: YYYY-MM-DD
- Status: Proposed | Approved | Rejected | Superseded
- Scope: <project / release / feature it applies to>
- Approver: <human who approved>
- Related: <spec / PR / commit>

## Decision
## Reason
## Evidence
   (links to checks, test output, review findings, eval results)
```

## Index

No decision records yet.
