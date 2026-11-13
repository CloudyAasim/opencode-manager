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
| `GET` | `/api/bff/pending` | What the agent is waiting for, across one or more working directories | `PendingListResponse` |

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

### The event stream says the same thing in the same words

The client learns about a conversation that is happening from the event stream,
and the stream is translated into the same versioned dialect the answers are
in - so one cache slot holds one shape, and the client never has to hold the
agent's words and the layer's words at the same time.

What is translated is the shape of the conversation: a session appearing,
changing or going away, a message being written, a part of it arriving or
changing, a part being taken away, a message being removed, the session going
idle, being compacted, or failing. Everything else that travels on the stream -
the agent's status, its to-do list, the permissions and the questions it is
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
