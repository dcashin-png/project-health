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
  -d '{"fields":{"project":{"key":"GRO"},"issuetype":{"name":"Epic"},"summary":"New Pricing Page Test","customfield_10002":"New Pricing Page Test","priority":{"name":"Needs Prioritization"},"customfield_19103":{"value":"Pipeline"},"customfield_19001":500000,"customfield_18401":{"value":"Monetization"}}}' \
  "https://jira.tinyspeck.com/rest/api/2/issue"
```

You can include any of the custom fields listed below when creating an issue.

## Common Custom Fields

These are the Growth experiment fields used in this project:

| Field | ID | Type |
|---|---|---|
| Experiment Status | `customfield_19103` | `{"value": "Running"}` |
| Experiment Start Date | `customfield_18803` | `"2026-03-26"` |
| Experiment End Date | `customfield_14505` | `"2026-04-26"` |
| Experiment DRI | `customfield_18500` | `[{"name": "username"}]` |
| Growth Squad | `customfield_18401` | `{"value": "Squad Name"}` |
| Product Category | `customfield_18801` | `{"value": "Category"}` |
| Estimated ACV | `customfield_19001` | `211124` (number) |
| Actual ACV | `customfield_19000` | `150000` (number) |
| GA Launch Date | `customfield_18503` | `"2026-03-26"` |
| Expected Launch Start Date | `customfield_10611` | `"2026-03-26"` |

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
