# The layer the web client talks to

> Not the versioned API. The versioned API (`docs/api/v1.md`) is the contract
> for native clients: one agent, one working directory, one request at a time.
> This is the contract for the web client, which wants something different.

## Why there is a layer at all

The web client used to ask the agent for its sessions directly, and it did the
server's work itself: it held a list of working directories, asked the agent
for one page from each of them, merged the pages, and kept one cursor per
directory so it could ask for the next page of each in turn.

That is a server's job wearing a client's clothes. The browser paid for N
round trips to draw one list, and every place that draws a list had to know
how to merge pages.

So the client asks this layer, and this layer asks the layers underneath. The
client never reaches for `/api/v1` itself: that contract is explicitly allowed
to move, and a client bound to it would move with it.

## Query parameters

| Parameter | Meaning |
| --- | --- |
| `directories` | A working directory to list. Repeat it for more than one. |
| `agent` | Which registered agent answers. Omit it and the default agent answers. |
| `limit` | How many sessions to return **per directory**. |
| `search` | A word to look for among the sessions. |
| `cursors` | A JSON object of `directory` to cursor, from a previous answer. |

`limit` is per directory, exactly as it was when the client did this itself: a
client that asked for twenty-five sessions and had three directories got
seventy-five, and it still gets seventy-five.

## Endpoints

| Method | Path | What it does | Shape |
| --- | --- | --- | --- |
| `GET` | `/api/bff/sessions` | The sessions of one or more working directories | `BffSessionListResponse` |
| `POST` | `/api/bff/sessions` | A new conversation, in a named working directory | `SessionResponse` |
| `GET` | `/api/bff/sessions/:id` | One conversation, and where it lives | `SessionResponse` |
| `PATCH` | `/api/bff/sessions/:id` | A conversation's new title | `SessionResponse` |
| `DELETE` | `/api/bff/sessions/:id` | A conversation, gone | `DeletedResponse` |
| `POST` | `/api/bff/sessions/:id/abort` | Stop what the conversation is doing | `AcceptedResponse` |
| `GET` | `/api/bff/sessions/:id/messages` | What was said in one conversation | `MessageListResponse` |
| `POST` | `/api/bff/sessions/:id/prompts` | Saying something to one conversation | `AcceptedResponse` |
| `POST` | `/api/bff/sessions/:id/revert` | Taking a message back | `SessionResponse` |
| `POST` | `/api/bff/sessions/:id/permissions/:permissionId/reply` | Answering a permission request | `AcceptedResponse` |
| `POST` | `/api/bff/sessions/:id/questions/:questionId/reply` | Answering a question | `AcceptedResponse` |
| `POST` | `/api/bff/sessions/:id/questions/:questionId/reject` | Turning a question down | `AcceptedResponse` |
| `POST` | `/api/bff/sessions/:id/commands` | Running a command in one conversation | `AcceptedResponse` |
| `POST` | `/api/bff/sessions/:id/summarize` | Shortening one conversation | `AcceptedResponse` |
| `POST` | `/api/bff/sessions/:id/fork` | Taking a copy of one conversation | `SessionResponse` |
| `POST` | `/api/bff/sessions/:id/shell` | Running a command in one conversation's own shell | `AcceptedResponse` |
| `GET` | `/api/bff/pending` | What the agent is waiting for, across one or more working directories | `PendingListResponse` |
| `GET` | `/api/bff/status` | How busy every conversation is, across one or more working directories | `BffConversationStatusResponse` |
| `GET` | `/api/bff/commands` | The commands the agent knows | `BffCommandListResponse` |
| `GET` | `/api/bff/working-modes` | The ways of working a conversation can be had in | `BffWorkingModeListResponse` |
| `GET` | `/api/bff/defaults` | What the agent does by default | `BffAgentDefaultsResponse` |
| `GET` | `/api/bff/providers` | The models that may be picked | `BffProviderListResponse` |
| `GET` | `/api/bff/files/search` | The files that match a word | `BffFileSearchResponse` |
| `GET` | `/api/bff/mcp` | The tool servers the agent knows | `BffMcpServerListResponse` |
| `POST` | `/api/bff/mcp` | Adding a tool server | `AcceptedResponse` |
| `POST` | `/api/bff/mcp/:name/connect` | Starting a tool server | `AcceptedResponse` |
| `POST` | `/api/bff/mcp/:name/disconnect` | Stopping a tool server | `AcceptedResponse` |
| `POST` | `/api/bff/mcp/:name/auth/authenticate` | Asking a tool server to authorize itself | `AcceptedResponse` |
| `POST` | `/api/bff/mcp/:name/auth/callback` | Finishing an authorization | `AcceptedResponse` |
| `DELETE` | `/api/bff/mcp/:name/auth` | Taking the authorization away | `AcceptedResponse` |
| `GET` | `/api/bff/provider-auth/methods` | How each provider may be logged in | `BffProviderAuthMethodsResponse` |
| `POST` | `/api/bff/provider-auth/:providerId/authorize` | Starting an authorization | `BffProviderOAuthAuthorizationResponse` |
| `POST` | `/api/bff/provider-auth/:providerId/callback` | Finishing an authorization | `AcceptedResponse` |
| `GET` | `/api/bff/provider-auth/credentials` | The providers that have credentials | `BffProviderCredentialListResponse` |
| `POST` | `/api/bff/provider-auth/credentials/:providerId` | Writing a credential down | `AcceptedResponse` |
| `DELETE` | `/api/bff/provider-auth/credentials/:providerId` | Taking a credential away | `AcceptedResponse` |

## The shapes

### `BffSessionListResponse`

| Field | Type | Meaning |
| --- | --- | --- |
| `sessions` | `Session[]` | Every session of every named directory, newest first |
| `cursors` | object | Where the next page of each directory starts |

A `Session` is the versioned API's `Session` - there is one truth about what a
session is. What this layer adds is the part that is its own: several
directories at once, and a cursor for each of them.

A session that the agent does not place is given the directory it was asked
about: the agent answered "the sessions of this directory", and a session with
no place belongs to nobody - which is a different answer from "not yours".

A directory that has no entry in `cursors` has no more pages. The agent said
so, and saying it again would cost a round trip.

### `PendingListResponse`

| Field | Type | Meaning |
| --- | --- | --- |
| `permissions` | `PendingPermission[]` | The permissions the agent is waiting for |
| `questions` | `PendingQuestion[]` | The questions the agent is waiting for |

A `PendingPermission` and a `PendingQuestion` are the versioned API's - there
is one truth about what a pending request is. What this layer adds is the
part that is its own: several directories at once.

The client used to ask for this itself: two requests per working directory -
the pending permissions of it and the pending questions of it - and it worked
out which conversation each request belonged to. That is the server's job.

A request belongs to a conversation, so the conversation decides whose it is.

### One conversation

The client used to name the working directory next to every conversation it
asked about, because the versioned API speaks to one agent in one directory at
a time. Here it names the conversation, and this layer works out where the
conversation lives.

It works it out in three steps, and the first one that answers wins:

1. **The ledger knows.** It recorded the directory when the conversation came
   into existence, and it is the authority: a conversation can sit in one
   person's checkout and still belong to another.
2. **The agent knows.** Asked about the conversation itself, an agent says
   where it was worked on.
3. **The caller's own directories know.** A conversation from before the
   ledger existed is looked for in the directories the caller named, and the
   one it turns up in is the place it belongs.

So `directories` is still accepted by every endpoint that takes one
conversation - it is the third step, and it is a fallback rather than the
answer. A client that knows a conversation's directory does not have to say
which one it is; a client that does not know it says the directories it works
in, and this layer finds the conversation among them.

| Endpoint | Body | Answer |
| --- | --- | --- |
| `POST /api/bff/sessions` | `{ "title"?: string, "directory": string }` | `SessionResponse` |
| `PATCH /api/bff/sessions/:id` | `{ "title": string }` | `SessionResponse` |
| `DELETE /api/bff/sessions/:id` | - | `DeletedResponse` |
| `POST /api/bff/sessions/:id/abort` | - | `AcceptedResponse` |

A conversation that is created here is written down in the ledger with the
person who asked for it, in the same moment the conversation comes into
existence - which is what lets every later request tell one person's
conversation from another's.

### The conversation itself

Reading the conversation, saying something to it and taking a message back are
this layer's job too, for the same reason the list is: the client would
otherwise have to know which agent is behind the conversation and which working
directory it lives in before it could ask anything about it.

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /api/bff/sessions/:id/messages` | - | `MessageListResponse` |
| `POST /api/bff/sessions/:id/prompts` | `SendPromptRequest` | `AcceptedResponse` |
| `POST /api/bff/sessions/:id/revert` | `SessionRevert` | `SessionResponse` |

The messages are the versioned API's messages - there is one truth about what a
message is - and the prompt is the versioned API's prompt: the words, the files
that go with them, and the model and the agent that should answer all travel
together, so the conversation is answered the way the caller asked for it and
not the way the server felt like.

A prompt that says nothing is not a prompt: the request has to carry words or a
file to hand over, so a caller who meant to say something cannot end up with an
empty turn in the conversation and no idea why.

Taking a message back rolls the conversation back to the message that is named.
The agent does the taking; the answer is the conversation as it is afterwards,
read back rather than guessed at.

### What the conversation is waiting for

A permission and a question both hang on a conversation, so the conversation
decides whose they are - and the client names the conversation, the same way it
names one everywhere else.

| Endpoint | Body | Answer |
| --- | --- | --- |
| `POST /api/bff/sessions/:id/permissions/:permissionId/reply` | `PermissionReply` | `AcceptedResponse` |
| `POST /api/bff/sessions/:id/questions/:questionId/reply` | `QuestionReply` | `AcceptedResponse` |
| `POST /api/bff/sessions/:id/questions/:questionId/reject` | - | `AcceptedResponse` |

A permission is answered once, always, or not at all. A question may have more
than one part, and the answers come back in the order the parts were asked.

### How busy everything is

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /api/bff/status` | - | `BffConversationStatusResponse` |

One request for every directory, the way the session list is one request for
every directory. The statuses are the versioned API's - there is one truth
about how busy a conversation is - and the event stream says them in the same
words, because a client that hears about a status and asks for it must not
have to know which dialect it is holding.

A status belongs to a conversation, so it is narrowed to the caller the same
way the conversation list is.

### The agent's own face

The commands the agent knows, the ways of working a conversation can be had in,
and what the agent does by default. The client used to ask the agent for all
three itself, and it held the agent's own words about them - so every place
that drew a command palette, or let a person pick a way of working, had to
speak those words too.

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /api/bff/commands` | - | `BffCommandListResponse` |
| `GET /api/bff/working-modes` | - | `BffWorkingModeListResponse` |
| `GET /api/bff/defaults` | - | `BffAgentDefaultsResponse` |

The commands are the versioned API's `Command`s, the ways of working are the
versioned API's `WorkingMode`s, and the defaults are the versioned API's
`AgentDefaults` - there is one truth about what a command is, whichever agent
is behind it.

The word "agent" is taken by the program that does the work, so the ways of
working have a word of their own: a `WorkingMode` is what the agent is called
when it is doing the work rather than the program that is doing it.

`AgentDefaults` carries two things and no more: the model a conversation
starts on, and the way of working it starts in. The rest of an agent's
configuration is its own business - translating all of it would turn the
answer into a report on one agent rather than a word all of them share.

These three are not a person's, so they are not narrowed to the caller the way
a conversation is. The working directories they are read from are the
caller's, though: a directory that is not yours is not yours to read the
agent's own words out of.

When several directories are named, the first one answers - a command or a
way of working that two directories both have is the same one. The defaults
are one answer and not a list, so the first directory answers them too.

### The catalogue of models

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /api/bff/providers` | - | `BffProviderListResponse` |
| `GET /api/bff/files/search` | - | `BffFileSearchResponse` |

The client used to ask the agent for its catalogue itself, by building the
agent's own path, and it got the agent's own catalogue back: megabytes long,
in the agent's vocabulary, and with the provider's credentials in it. Every
place that drew a model picker had to speak those words too.

| Field | Type | Meaning |
| --- | --- | --- |
| `providers` | `Provider[]` | Every provider the agent knows, and the models of each |
| `default` | object | The model each provider starts on, by provider name |

A `Provider` and a `Model` are the versioned API's - there is one truth about
what a model is. A model is known by one name: the one it is known by inside
its provider, which is also the name a conversation is started with. A model
that says nothing about its cost has an unknown cost rather than a free one,
so the cost, the limits, the capabilities and the modalities may all be null.

The credentials do not travel. A client that draws a picker needs to know
which provider is ready to be used and which models it has; the rest is the
provider's business, and the browser is not where it belongs.

The catalogue belongs to the agent rather than to a working directory, so the
directory is named only so that the layer can say whose agent it is. The
client asks this layer once, and every place that draws a picker reads the
same answer.

### The files that match a word

`GET /api/bff/files/search?query=<word>` answers with the paths that match.

| Field | Type | Meaning |
| --- | --- | --- |
| `files` | `string[]` | The paths, as the agent knows them |

The paths come back whole, and relative to the working directory they are in:
a path that is not the whole path is not a path.

A file search is about a working directory, so one has to be named, and it has
to be the caller's - a directory that is not yours is refused rather than
searched. A search without a word is a bad request, not an empty list.

### The tool servers

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /api/bff/mcp` | - | `BffMcpServerListResponse` |
| `POST /api/bff/mcp` | `{ "name": string, "config": McpServerConfig }` | `AcceptedResponse` |
| `POST /api/bff/mcp/:name/connect` | - | `AcceptedResponse` |
| `POST /api/bff/mcp/:name/disconnect` | - | `AcceptedResponse` |
| `POST /api/bff/mcp/:name/auth/authenticate` | - | `AcceptedResponse` |
| `POST /api/bff/mcp/:name/auth/callback` | `{ "code": string }` | `AcceptedResponse` |
| `DELETE /api/bff/mcp/:name/auth` | - | `AcceptedResponse` |

| Field | Type | Meaning |
| --- | --- | --- |
| `servers` | `McpServer[]` | Every tool server the agent knows, and what state each is in |

A `McpServer` is the versioned API's - there is one truth about what a tool
server is:

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | `string` | The name it is configured under |
| `state` | `McpServerState` | What state it is in |
| `detail` | `string \| null` | What went wrong, when the agent said anything |
| `kind` | `"local" \| "remote" \| null` | Whether it runs here as a command, or somewhere else by address |
| `command` | `string[] \| null` | The command it runs, when it runs here |
| `url` | `string \| null` | The address it answers on, when it is somewhere else |
| `oauth` | `{ scope, clientId } \| null` | What it wants to be authorized for |

The client used to ask the agent about these itself: for the state of each
server, and for the document the servers are written down in. That document is
also where the credentials of every model provider on the host live - so
asking for it handed the browser the keys to every model this server can
reach - and the secret that belongs to an OAuth client was in it too.

So what comes back is the server rather than the document. The provider's
credentials do not travel, and the OAuth secret does not either: a client that
draws a list of servers has no reason to hold one. The manager reads that
secret out of the configuration itself when a server asks to be authorized.

A change to a server lands in a working directory when one is named, and a
directory that is not the caller's is refused. A change with no directory is a
change to the server as a whole - to every conversation on the host - so only
the administrator may make one. Adding a server is always everybody's business,
and so it is always the administrator's.

A server the agent did not speak of is `unknown`: it is written down, and
nobody has said whether it works.

### How a model gets logged in

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /api/bff/provider-auth/methods` | - | `BffProviderAuthMethodsResponse` |
| `POST /api/bff/provider-auth/:providerId/authorize` | `{ "method": number, "inputs": object \| null }` | `BffProviderOAuthAuthorizationResponse` |
| `POST /api/bff/provider-auth/:providerId/callback` | `{ "method": number, "code": string \| null }` | `AcceptedResponse` |
| `GET /api/bff/provider-auth/credentials` | - | `BffProviderCredentialListResponse` |
| `POST /api/bff/provider-auth/credentials/:providerId` | `{ "apiKey": string }` | `AcceptedResponse` |
| `DELETE /api/bff/provider-auth/credentials/:providerId` | - | `AcceptedResponse` |

There is no separate door for "does this one have credentials": the list says
which providers do, and asking again would be the same question twice.

| Field | Type | Meaning |
| --- | --- | --- |
| `methods` | object | The ways each provider may be logged in, by provider name |
| `authorization` | `ProviderOAuthAuthorization` | Where to go, and what to do there |
| `credentials` | `string[]` | The providers that have credentials |

A way of logging in is the versioned API's - there is one truth about what a
way of logging in is:

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `"oauth" \| "api"` | Whether a key is typed in, or an authorization is done elsewhere |
| `label` | `string` | What it is called |
| `prompts` | `PromptField[] \| null` | What the provider asks before it will let anybody in |

A question is flat rather than a choice of two shapes: a question that is not
a choice has no options, and a question that is always asked has no
condition. Saying "none" is one word; making the client ask which of the
fields is there is two.

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `"text" \| "select"` | Whether it is typed in or picked |
| `key` | `string` | What the answer is called |
| `message` | `string` | What the person is asked |
| `placeholder` | `string \| null` | What the person is shown before they answer |
| `options` | `{ label, value, hint }[] \| null` | The choices, when it is a choice |
| `when` | `{ key, value } \| null` | The answer that makes this question asked |

A condition is one answer, not a condition: the answer equals the value. The
agent spells that with an operator of its own, and this layer carries what the
condition means rather than how it is spelled - and drops a question whose
condition it does not understand, because asking it unconditionally would ask a
question that should not have been asked.

An authorization is the versioned API's as well:

| Field | Type | Meaning |
| --- | --- | --- |
| `url` | `string` | Where the person goes |
| `method` | `"auto" \| "code"` | Whether the provider answers on its own, or hands back a code |
| `instructions` | `string` | What the person is told to do while they are out |

The client used to ask the manager's own doors for these, and those doors
answered in the manager's older words - and, for the ways themselves, in the
agent's: a list of methods the client never checked against anything, and
errors that named the agent's own failures.

So the ways are asked for through the contract now, and the failures are said
in this layer's words. The reason travels in the details of the failure,
because the versioned vocabulary of codes is a coarse one - "bad request"
alone cannot tell a missing code from a rejected one:

```json
{ "error": { "code": "bad_request", "message": "The provider refused the authorization",
             "details": { "reason": "code_missing", "detail": "field: code" } } }
```

| Reason | Meaning |
| --- | --- |
| `invalid_request` | The request was not one the provider could answer |
| `bad_request` | The provider said no, and did not say why |
| `authorization_missing` | There is no authorization in progress to finish |
| `code_missing` | The provider wants a code, and there was none |
| `callback_failed` | The provider rejected the authorization |
| `validation_failed` | What was given did not pass the provider's checks |

The credentials are the manager's own - they are written into the
configuration of the person who typed them - and they are the one half of
this family that the agent is not asked about.

### What hangs on a conversation

The commands, the shell, the copy and the summary all hang on a conversation,
so the conversation decides whose they are - and the client names the
conversation, the same way it names one everywhere else.

| Endpoint | Body | Answer |
| --- | --- | --- |
| `POST /api/bff/sessions/:id/commands` | `SendCommandRequest` | `AcceptedResponse` |
| `POST /api/bff/sessions/:id/summarize` | `SummarizeRequest` | `AcceptedResponse` |
| `POST /api/bff/sessions/:id/fork` | `ForkRequest` | `SessionResponse` |
| `POST /api/bff/sessions/:id/shell` | `ShellRequest` | `AcceptedResponse` |

A command's answer and a shell's answer are messages in the conversation, so
they are read from there rather than carried back: a prompt's answer is not
carried back either, and the two are the same kind of thing.

A copy is a conversation like any other, and it belongs to whoever asked for
it - so it is written down in the ledger at the moment it is made, the same
way a conversation made through the browser's other door is.

### The event stream says the same thing in the same words

The client learns about a conversation that is happening from the event stream,
and the stream is translated into the same versioned dialect the answers are
in - so one cache slot holds one shape, and the client never has to hold the
agent's words and the layer's words at the same time.

What is translated is the shape of the conversation: a session appearing,
changing or going away, a message being written, a part of it arriving or
changing, a part being taken away, a message being removed, the session going
idle, being compacted, how busy it is, or failing. Everything else that travels
on the stream - the agent's to-do list, the permissions and the questions it is
waiting on - is passed through as it is, because none of it carries the shape
of the conversation.

A part of a conversation that arrives in a kind this layer does not know is not
dropped and not turned into text: it is called `other` and keeps whatever words
it had.

### What it refuses

- **No session, no list.** The same rule the rest of the server uses - one
  session, or no session - answering in the same envelope.
- **A directory that is not yours.** Naming it is refused, rather than the
  list quietly coming back empty.
- **A conversation that is not yours.** An agent knows about conversations, not
  about people: it answers with everything in a directory, and the question of
  whose conversations those are is answered here.
- **A pending request that is not yours.** A permission belongs to a
  conversation, so the conversation decides whose request it is.

A conversation that is not yours is answered exactly like one that does not
exist: `404`, with the same words. A caller who may not have it should not be
able to learn that it is there.
