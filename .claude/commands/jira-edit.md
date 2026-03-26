Help the user create or edit JIRA issues from the terminal using `slack-uberproxy-curl`.

## Auth Check

First, verify the user is authenticated by running:

```
slack-uberproxy-curl -s "https://jira.tinyspeck.com/rest/api/2/myself"
```

If this returns an auth error or HTML instead of JSON, tell the user to run `kinit` and enter their corp password, then retry. Kerberos tickets expire after ~10 hours, so this is the most common issue.

They must also be on the corp VPN.

## Reading an Issue

To look up an issue, use the JIRA MCP tools:
- `get_issue` with the issue key (e.g. STEP-1390)
- `search_issues` with JQL for bulk lookups

## Editing an Issue

To update fields on a JIRA issue, run:

```
slack-uberproxy-curl -s -X PUT \
  -H "Content-Type: application/json" \
  -d '{"fields":{ ... }}' \
  -w "\n%{http_code}" \
  "https://jira.tinyspeck.com/rest/api/2/issue/ISSUE-KEY"
```

A 204 status code means success. 400+ means an error — parse the response body for details.

## Creating an Issue

To create a new JIRA issue, run:

```
slack-uberproxy-curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"fields":{"project":{"key":"PROJECT"},"issuetype":{"name":"Epic"},"summary":"Title here", ...}}' \
  "https://jira.tinyspeck.com/rest/api/2/issue"
```

A successful response returns JSON with `id`, `key`, and `self`. An error response contains `errors` or `errorMessages`.

### Required Fields for an Epic

| Field | Format |
|---|---|
| Project | `{"project":{"key":"GRO"}}` |
| Issue Type | `{"issuetype":{"name":"Epic"}}` |
| Summary | `"summary":"My new experiment"` |
| Epic Name | `{"customfield_10002":"My new experiment"}` |
| Priority | `{"priority":{"name":"Needs Prioritization"}}` |

### Example: Create a Growth Experiment Epic

```
slack-uberproxy-curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"fields":{"project":{"key":"GRO"},"issuetype":{"name":"Epic"},"summary":"New Pricing Page Test","customfield_10002":"New Pricing Page Test","priority":{"name":"Needs Prioritization"},"customfield_19103":{"value":"Planning"},"customfield_19001":500000,"customfield_18401":{"value":"Monetization"}}}' \
  "https://jira.tinyspeck.com/rest/api/2/issue"
```

You can include any of the custom fields listed below when creating an issue.

## Field Reference

### Finding Any Field

If the user asks about a field not listed below, look it up dynamically:

1. **Find the field ID by name** — use the JIRA MCP resource `jira:///jira.tinyspeck.com/fields` to get all 425 fields with their IDs and types.

2. **Find allowed values for a select/option field** — search for issues that have the field set and extract distinct values:
```
slack-uberproxy-curl -s "https://jira.tinyspeck.com/rest/api/2/search?jql=%22FIELD_NAME%22%20is%20not%20EMPTY&maxResults=200&fields=FIELD_ID" | python3 -c "
import json, sys
data = json.load(sys.stdin)
vals = {}
for issue in data.get('issues', []):
    v = issue['fields'].get('FIELD_ID')
    if v and isinstance(v, dict):
        vals[v.get('value', '')] = v.get('id', '')
for k in sorted(vals): print(f'{k} (id: {vals[k]})')
"
```

3. **Check required fields for a project/issue type**:
```
slack-uberproxy-curl -s "https://jira.tinyspeck.com/rest/api/2/issue/createmeta?projectKeys=PROJECT&issuetypeNames=Epic&expand=projects.issuetypes.fields"
```

### Field Value Formats by Type

| Type | Format |
|---|---|
| `option` (select) | `{"value": "Option Name"}` |
| `array` (multiselect) | `[{"value": "A"}, {"value": "B"}]` |
| `user` (userpicker) | `{"name": "username"}` |
| `array` (multiuserpicker) | `[{"name": "user1"}, {"name": "user2"}]` |
| `date` (datepicker) | `"2026-03-26"` |
| `datetime` | `"2026-03-26T10:00:00.000-0700"` |
| `number` (float) | `500000` |
| `string` (text/textarea/url) | `"some text"` |
| `option-with-child` (cascading) | `{"value": "Parent", "child": {"value": "Child"}}` |

### Common Growth Experiment Fields

| Field | ID | Format |
|---|---|---|
| Experiment Status | `customfield_19103` | `{"value": "STATUS"}` |
| Experiment Start Date | `customfield_18803` | `"2026-03-26"` |
| Experiment End Date | `customfield_14505` | `"2026-04-26"` |
| Experiment DRI | `customfield_18500` | `[{"name": "username"}]` |
| Growth Squad | `customfield_18401` | `{"value": "Squad Name"}` |
| Product Category | `customfield_18801` | `{"value": "Category"}` |
| Estimated ACV | `customfield_19001` | `500000` (number) |
| Actual ACV | `customfield_19000` | `350000` (number) |
| GA Launch Date | `customfield_18503` | `"2026-03-26"` |
| Expected Launch Start Date | `customfield_10611` | `"2026-03-26"` |
| Funnel Stage | `customfield_18403` | `{"value": "Stage"}` |
| Product Manager | `customfield_10606` | `{"name": "username"}` |
| Engineering Manager | `customfield_10616` | `{"name": "username"}` |
| Tech Lead | `customfield_10603` | `{"name": "username"}` |
| Engineer(s) | `customfield_14800` | `[{"name": "username"}]` |
| Designer(s) | `customfield_11502` | `[{"name": "username"}]` |
| Product Team | `customfield_10024` | `[{"value": "Team"}]` |
| Weekly Update | `customfield_10604` | `"update text"` |
| Project Status | `customfield_10613` | `{"value": "Status"}` |
| Channel | `customfield_10607` | `"#channel-name"` |
| Plan Type | `customfield_10608` | `[{"value": "Free"}, {"value": "Pro"}]` |
| Houston Toggle(s) | `customfield_17100` | `"toggle text"` |
| PDE V2MOM Method | `customfield_18800` | `{"value": "Method"}` |
| Estimated GA Release Quarter | `customfield_13520` | `{"value": "FY27 Q1"}` |
| Delivery Tier | `customfield_18301` | `{"value": "Tier"}` |
| Delivery Enablement | `customfield_16700` | `[{"value": "Option"}]` |
| Release Marketing | `customfield_11405` | `{"value": "Option"}` |
| Product Review Tier | `customfield_19101` | `{"value": "Tier"}` |
| MAU | `customfield_19200` | `0` (number) |
| MDP | `customfield_19201` | `0` (number) |
| Invoice? | `customfield_18420` | `{"value": "Option"}` |

### Known Allowed Values

**Experiment Status**: Development, Planning, Running, Paused/Issues, Analysis, Cancelled, Concluded Control, GA Complete

**Product Category**: New Product, New Feature, Feature Update, Experiment, Trust & Reliability

## Example: Update Experiment Status

```
slack-uberproxy-curl -s -X PUT \
  -H "Content-Type: application/json" \
  -d '{"fields":{"customfield_19103":{"value":"Running"}}}' \
  -w "\n%{http_code}" \
  "https://jira.tinyspeck.com/rest/api/2/issue/STEP-1390"
```

## Workflow

### Editing
1. Ask the user which issue(s) they want to edit and what fields to change
2. Look up the current issue state first so you can confirm the change
3. Show the user what you're about to change and get confirmation before running the PUT
4. Run the update and report success/failure

### Creating
1. Ask the user what they want to create (project, title, type, any custom fields)
2. Show the user the fields you'll set and get confirmation before running the POST
3. Run the create and return the new issue key and URL (https://jira.tinyspeck.com/browse/ISSUE-KEY)
