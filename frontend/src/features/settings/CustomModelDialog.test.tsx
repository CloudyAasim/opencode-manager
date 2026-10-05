import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, act, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { CustomModelDialog, CUSTOM_MODEL_FORM_ID } from './CustomModelDialog'
import type { CustomModelDraft } from './custom-provider'

// jsdom implements neither the pointer capture methods nor PointerEvent, and
// Radix Select's item handler calls `hasPointerCapture` on whatever the pointer
// landed on. Stubbed here rather than in the shared setup file so the workaround
// stays next to the only tests that need it, and so it is obvious this is a
// jsdom gap rather than something the component does.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
})

type Props = ComponentProps<typeof CustomModelDialog>

function setup(props: Partial<Props> = {}) {
  const onSubmit = vi.fn()
  const onOpenChange = vi.fn()
  const view = render(<CustomModelDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} {...props} />)
  return { onSubmit, onOpenChange, user: userEvent.setup(), view }
}

/**
 * The only way to reach the submit handler under jsdom: it does not submit a
 * form when a button inside it is clicked, and it does not implement implicit
 * submission on Enter. Both of those tests would pass with the handler deleted,
 * so the event is fired on the form itself.
 *
 * The `act` is load-bearing. react-hook-form's `handleSubmit` is async, so a
 * bare `expect(onSubmit).not.toHaveBeenCalled()` on the line after the fire runs
 * before the handler has had any chance to call, and passes whether or not the
 * guard it is checking is there. `await act(async ...)` drains the microtask
 * queue first, which is what makes "it did not happen" mean what it says.
 */
function submitForm() {
  return act(async () => {
    fireEvent.submit(document.getElementById(CUSTOM_MODEL_FORM_ID) as HTMLFormElement)
  })
}

/** The three limits the rest of the app reads without a guard. */
async function fillRequiredLimits(
  user: ReturnType<typeof userEvent.setup>,
  { id = 'my-model', context = '128000', output = '16384' } = {},
) {
  await user.type(screen.getByLabelText('Model ID'), id)
  await user.type(screen.getByLabelText('Context window'), context)
  await user.type(screen.getByLabelText('Max output tokens'), output)
}

/**
 * Every Radix Select trigger in this dialog is a bare button with no associated
 * label, so there is no accessible name to select on and the triggers have to be
 * taken by position. The order is fixed by the form: status first, interleaved
 * reasoning next (only rendered while reasoning is on), then one reasoning
 * effort per thinking level.
 */
function selectTrigger(index: number) {
  return screen.getAllByRole('combobox')[index]
}

async function pickOption(
  user: ReturnType<typeof userEvent.setup>,
  trigger: HTMLElement,
  optionName: string,
) {
  await user.click(trigger)
  await user.click(screen.getByRole('option', { name: optionName }))
}

const accepts = () => within(screen.getByRole('group', { name: 'Accepts' }))
const produces = () => within(screen.getByRole('group', { name: 'Produces' }))

function draft(over: Partial<CustomModelDraft> = {}): CustomModelDraft {
  return {
    id: 'my-model',
    name: 'My Model',
    family: '',
    status: '',
    releaseDate: '',
    contextLimit: '128000',
    inputLimit: '',
    outputLimit: '16384',
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    inputModalities: { text: true, audio: false, image: false, video: false, pdf: false },
    outputModalities: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: 'none',
    costInput: '',
    costOutput: '',
    costCacheRead: '',
    costCacheWrite: '',
    variants: [],
    headers: [],
    optionsJson: '',
    ...over,
  }
}

describe('CustomModelDialog', () => {
  it('refuses to save a model that is missing an id, a context window or an output limit', async () => {
    // A model declared with only a name is not a half-finished entry, it is a
    // broken one: the model list reads `limit.context` and `limit.output` off
    // every model with no null guard. So the dialog has to refuse, and it has
    // to say which field, or the user is left guessing.
    //
    // What would pass without the guard: a handler that called `onSubmit` with
    // the blank values. Asserting only on the messages would pass even then,
    // because a submit that never fires also never renders one - the call
    // assertion is the half that has teeth.
    const { onSubmit, user } = setup()

    await user.click(screen.getByRole('button', { name: 'Save model' }))
    await submitForm()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('A model ID is required')).toBeInTheDocument()
    expect(screen.getByText('The context window is required')).toBeInTheDocument()
    expect(screen.getByText('The output limit is required')).toBeInTheDocument()
  })

  it('saves a model that has all three of them', async () => {
    // The control for the refusal above. Without it a handler that refused
    // everything would pass that test, so this is what makes it mean "refuses
    // the incomplete" rather than "never submits".
    const { onSubmit, user } = setup()
    await fillRequiredLimits(user)

    await submitForm()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      id: 'my-model',
      contextLimit: '128000',
      outputLimit: '16384',
    })
  })

  it('hands back trimmed text, so a padded id cannot become a second provider key', async () => {
    // The draft becomes a `provider.<id>.models.<modelId>` key in the config,
    // and a config key with a stray space in it is a model nothing can select.
    // Trimming is the only thing standing between a copy-paste and that.
    //
    // This matters because it is a property of the emitted value, not of the
    // field: the inputs still show what was typed, so asserting on the input
    // would pass whether or not the draft was cleaned.
    //
    // The free-text boxes are the half worth pinning. `id`, `name`, the limits
    // and the costs are trimmed by the zod schema before this handler ever sees
    // them, so trimming them here is belt-and-braces and no test can tell the
    // difference. `optionsJson` and a thinking level's `extraJson` are declared
    // as bare `z.string()`, so the schema leaves them exactly as typed and these
    // two `trim()` calls are the only thing keeping a padded JSON blob - which
    // would be re-serialised into the config with the padding still on - out of
    // the draft.
    const { onSubmit, user } = setup()
    await fillRequiredLimits(user, { id: '  my-model  ' })
    await user.type(screen.getByLabelText('Display name'), '  My Model  ')
    const options = screen.getByLabelText('Request options')
    await user.click(options)
    await user.paste('  {"top_p": 0.9}  ')
    await user.click(screen.getByRole('button', { name: 'Add thinking level' }))
    await user.type(screen.getByPlaceholderText('high'), 'deep')
    const variantBox = screen.getByPlaceholderText(/thinkingBudgetTokens/)
    await user.click(variantBox)
    await user.paste('  {"thinkingBudgetTokens": 8000}  ')

    await submitForm()

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      id: 'my-model',
      name: 'My Model',
      optionsJson: '{"top_p": 0.9}',
      variants: [{ name: 'deep', extraJson: '{"thinkingBudgetTokens": 8000}' }],
    })
  })

  it('locks the model id while editing, so a save cannot rename the model key', async () => {
    // Renaming the id while editing would write a second model and orphan the
    // first, because the draft is merged by key. The field is therefore
    // read-only rather than merely pre-filled, and that is the assertion: a
    // pre-filled but editable field still passes a "shows the id" check.
    const { onSubmit } = setup({ existingModelId: 'my-model', initialModel: draft() })

    const id = screen.getByLabelText('Model ID') as HTMLInputElement
    expect(id).toHaveValue('my-model')
    expect(id).toHaveAttribute('readonly')

    await submitForm()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ id: 'my-model' })
  })

  it('opens on the model it was given, rather than on a blank form', async () => {
    // Editing has to start from what is stored. A dialog that opened blank
    // would let a user re-save a model with every limit wiped, which is the
    // failure the reset-on-open effect exists to prevent.
    setup({ existingModelId: 'my-model', initialModel: draft({ reasoning: true, status: 'beta' }) })

    expect(screen.getByLabelText('Context window')).toHaveValue(128000)
    expect(screen.getByLabelText('Max output tokens')).toHaveValue(16384)
    expect(screen.getByRole('checkbox', { name: /^Tool calls/ })).toBeChecked()
    // `reasoning` is on, so the control that only applies to a reasoning model
    // is on screen too: the status select, and one more for interleaved reasoning.
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
  })

  it('opens blank again after a refused attempt, instead of keeping the last one', async () => {
    // A validation message that outlives its attempt is the other half of this:
    // reopening with "The context window is required" still on screen tells the
    // user the model they never saved is already rejected. Asserting only that
    // the field is blank would pass with the message left behind, so the message
    // is asserted too.
    const { user, view } = setup()
    await user.type(screen.getByLabelText('Model ID'), 'half-typed')
    await submitForm()
    // `waitFor` rather than a bare query: react-hook-form publishes the errors
    // one render after the submit resolves, so an immediate getByText reports a
    // dialog that is merely behind, not one that failed to show the message.
    await waitFor(() => expect(screen.getByText('The context window is required')).toBeInTheDocument())

    view.rerender(<CustomModelDialog open={false} onOpenChange={vi.fn()} onSubmit={vi.fn()} />)
    view.rerender(<CustomModelDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText('Model ID')).toHaveValue('')
    expect(screen.queryByText('The context window is required')).not.toBeInTheDocument()
  })

  it('shows interleaved reasoning only for a model that returns thinking', async () => {
    // `capabilities.interleaved` names the field a streaming endpoint carries
    // reasoning in, so it is meaningless - and misleading - on a model that does
    // not reason at all. Toggling reasoning off has to take the control away.
    const { user } = setup()

    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    await user.click(screen.getByRole('checkbox', { name: /^Reasoning/ }))
    expect(screen.getAllByRole('combobox')).toHaveLength(2)

    await user.click(screen.getByRole('checkbox', { name: /^Reasoning/ }))
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
  })

  it('records the status chosen for the model', async () => {
    // Status is what the model picker groups on, and it is written straight into
    // the config, so a status picked here has to arrive in the draft rather than
    // only showing up on screen.
    const { onSubmit, user } = setup()
    await fillRequiredLimits(user)

    await pickOption(user, selectTrigger(0), 'Beta')
    await submitForm()

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ status: 'beta' })
  })

  it('records the capabilities and modalities that were ticked', async () => {
    // Every capability is written explicitly rather than left to a default
    // nobody chose, so what the user ticked is the whole contract. Ticking
    // vision in "Accepts" only is the half that matters: the two groups are
    // separate fields, and a form that collapsed them would write an endpoint
    // claim the model cannot honour.
    const { onSubmit, user } = setup()
    await fillRequiredLimits(user)
    await user.click(screen.getByRole('checkbox', { name: /^Reasoning/ }))
    await user.click(screen.getByRole('checkbox', { name: /^Attachments/ }))
    await user.click(accepts().getByRole('checkbox', { name: 'Image' }))
    await user.click(produces().getByRole('checkbox', { name: 'Audio' }))

    await submitForm()

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      reasoning: true,
      attachment: true,
      inputModalities: { text: true, image: true, audio: false },
      outputModalities: { text: true, audio: true, image: false },
    })
  })

  it('refuses a thinking level with no name, or with a name used twice', async () => {
    // Thinking levels become `variants`, a map keyed by the level name. An
    // unnamed one is dropped by the builder and a duplicate silently overwrites
    // the first, so both are refused here rather than lost at write time.
    //
    // What would pass without the guard: a submit carrying two levels named
    // "high", where the config ends up with one effort and the user believes
    // they declared two.
    const { onSubmit, user } = setup()
    await fillRequiredLimits(user)
    await user.click(screen.getByRole('button', { name: 'Add thinking level' }))

    await submitForm()

    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('A thinking level needs a name')).toBeInTheDocument())

    const name = screen.getByPlaceholderText('high')
    await user.clear(name)
    await user.type(name, 'high')
    await user.click(screen.getByRole('button', { name: 'Add thinking level' }))
    await user.type(screen.getAllByPlaceholderText('high')[1]!, 'high')

    await submitForm()
    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('The thinking level high is used more than once')).toBeInTheDocument())
  })

  it('records a thinking level with its reasoning effort and its other options', async () => {
    // A variant is a named map of request options the model picker offers, so
    // both halves have to survive the round trip. Asserting the whole level
    // rather than the effort alone is what catches an effort that gets attached
    // to the wrong level.
    const { onSubmit, user } = setup()
    await fillRequiredLimits(user)
    await user.click(screen.getByRole('button', { name: 'Add thinking level' }))
    await user.type(screen.getByPlaceholderText('high'), 'deep')
    await pickOption(user, selectTrigger(1), 'high')
    // `paste` rather than `type`: user-event reads `{` and `[` in a `type`
    // string as the start of a key descriptor, so JSON cannot be typed at all.
    const box = screen.getByPlaceholderText(/thinkingBudgetTokens/)
    await user.click(box)
    await user.paste('{"thinkingBudgetTokens": 8000}')

    await submitForm()

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      variants: [{ name: 'deep', reasoningEffort: 'high', extraJson: '{"thinkingBudgetTokens": 8000}' }],
    })
  })

  it('refuses malformed JSON in a thinking level other options box', async () => {
    // The escape hatch is a raw JSON object. A string or an array parses but is
    // not an options map, and spreading it into the variant would write junk
    // straight into the config, so it is refused at the point of entry.
    const { onSubmit, user } = setup()
    await fillRequiredLimits(user)
    await user.click(screen.getByRole('button', { name: 'Add thinking level' }))
    await user.type(screen.getByPlaceholderText('high'), 'deep')
    const variantBox = screen.getByPlaceholderText(/thinkingBudgetTokens/)
    await user.click(variantBox)
    await user.paste('"not an object"')

    await submitForm()

    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getAllByText('That has to be a JSON object').length).toBeGreaterThan(0))
  })

  it('refuses a request header with no name, or with a name used twice', async () => {
    // Headers become a `headers` object keyed by name, so an unnamed row is
    // dropped and a duplicate overwrites the first - which for an auth header
    // means the endpoint silently gets the other one.
    const { onSubmit, user } = setup()
    await fillRequiredLimits(user)
    await user.click(screen.getByRole('button', { name: 'Add header' }))

    await submitForm()
    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('A request header needs a name')).toBeInTheDocument())

    await user.type(screen.getAllByPlaceholderText('X-Title')[0]!, 'X-Title')
    await user.click(screen.getByRole('button', { name: 'Add header' }))
    await user.type(screen.getAllByPlaceholderText('X-Title')[1]!, 'X-Title')

    await submitForm()
    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('The header X-Title is used more than once')).toBeInTheDocument())
  })

  it('records the request headers that were added', async () => {
    // The value is the half worth asserting: a form that kept the names and
    // dropped the values would still render a header list and would still pass
    // a count check.
    const { onSubmit, user } = setup()
    await fillRequiredLimits(user)
    await user.click(screen.getByRole('button', { name: 'Add header' }))
    await user.type(screen.getAllByPlaceholderText('X-Title')[0]!, 'X-Title')
    await user.type(screen.getAllByPlaceholderText('value')[0]!, 'openai')

    await submitForm()

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ headers: [{ name: 'X-Title', value: 'openai' }] })
  })

  it('removes a thinking level and a request header again once added', async () => {
    // Both lists are repeatable, so adding a row has to be undoable before the
    // save - otherwise a misclick leaves a half-filled level or a stray auth
    // header in the config, and the dialog offers no way back.
    //
    // Which row survives is the assertion that matters: a remove that dropped
    // the wrong one, or rebuilt the list from scratch, would still leave exactly
    // one row and pass a count check.
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Add thinking level' }))
    await user.type(screen.getByPlaceholderText('high'), 'deep')
    await user.click(screen.getByRole('button', { name: 'Add thinking level' }))
    await user.type(screen.getAllByPlaceholderText('high')[1]!, 'low')
    await user.click(screen.getAllByRole('button', { name: 'Remove thinking level' })[0]!)

    expect(screen.getAllByPlaceholderText('high').map((el) => (el as HTMLInputElement).value)).toEqual(['low'])

    await user.click(screen.getByRole('button', { name: 'Add header' }))
    await user.type(screen.getAllByPlaceholderText('X-Title')[0]!, 'X-First')
    await user.click(screen.getByRole('button', { name: 'Add header' }))
    await user.type(screen.getAllByPlaceholderText('X-Title')[1]!, 'X-Second')
    await user.click(screen.getAllByRole('button', { name: 'Remove header' })[0]!)

    expect(screen.getAllByPlaceholderText('X-Title').map((el) => (el as HTMLInputElement).value)).toEqual([
      'X-Second',
    ])
  })

  it('refuses malformed JSON in the model request options box', async () => {
    // Same reason as the thinking level box, one level up: this lands as
    // `options` on the model entry, and a non-object there is not something the
    // config reader can cope with.
    const { onSubmit, user } = setup()
    await fillRequiredLimits(user)
    const options = screen.getByLabelText('Request options')
    await user.click(options)
    await user.paste('[1, 2]')

    await submitForm()

    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('That has to be a JSON object')).toBeInTheDocument())
  })

  it('refuses a context window that is not a whole number of tokens', async () => {
    // `-1` or `1.5` would be written straight into `limit.context`, where the
    // usage bar divides by it. A negative context window is not a smaller
    // window, it is a broken model.
    //
    // Paired with the happy path above: without it, a schema that rejected
    // every number would pass this.
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText('Model ID'), 'my-model')
    await user.type(screen.getByLabelText('Context window'), '-1')
    await user.type(screen.getByLabelText('Max output tokens'), '16384')

    await submitForm()

    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('A whole number, or nothing')).toBeInTheDocument())
  })

  it('locks both buttons and says it is saving while the write is in flight', async () => {
    // The write goes to the config API. A second click while it is pending is a
    // second write of the same provider, and the cancel would close a dialog
    // whose result is about to land - so both have to be closed off, and the
    // label has to change so the button does not look live.
    //
    // This is a structural assertion on purpose. jsdom does not submit a form
    // when a button inside it is clicked, so a click-counting test would pass
    // whether or not the button was disabled.
    setup({ isSubmitting: true })

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('shows a save failure without losing what was typed', async () => {
    // The write failed. Closing and retyping a whole model because one field was
    // rejected would be the worst possible outcome here, so the form has to
    // still be filled in when the error is on screen.
    const { onSubmit, user } = setup({ error: 'Could not save the model' })
    await fillRequiredLimits(user)

    expect(screen.getByText('Could not save the model')).toBeInTheDocument()
    expect(screen.getByLabelText('Model ID')).toHaveValue('my-model')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('closes on cancel without saving', async () => {
    // Cancel is not a submit path: a dialog that posted a half-finished model
    // on cancel would write a broken entry into the config every time somebody
    // changed their mind.
    const { onSubmit, onOpenChange, user } = setup()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})