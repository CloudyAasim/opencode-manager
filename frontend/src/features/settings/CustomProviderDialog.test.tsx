import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { CustomProviderDialog, CUSTOM_PROVIDER_FORM_ID } from './CustomProviderDialog'
import { CUSTOM_MODEL_FORM_ID } from './CustomModelDialog'
import type { CustomModelDraft, CustomProviderDraft } from './custom-provider'

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

type Props = ComponentProps<typeof CustomProviderDialog>

function setup(props: Partial<Props> = {}) {
  const onSubmit = vi.fn()
  const onOpenChange = vi.fn()
  const view = render(
    <CustomProviderDialog open onOpenChange={onOpenChange} existingProviderIds={[]} onSubmit={onSubmit} {...props} />,
  )
  return { onSubmit, onOpenChange, user: userEvent.setup(), view }
}

/**
 * The only way to reach the submit handler under jsdom: it does not submit a
 * form when a button inside it is clicked, and it does not implement implicit
 * submission on Enter. Both of those tests would pass with the handler deleted.
 *
 * The `act` is load-bearing. react-hook-form's `handleSubmit` is async, so a
 * bare `expect(onSubmit).not.toHaveBeenCalled()` on the line after the fire runs
 * before the handler has had any chance to call, and passes whether or not the
 * guard it is checking is there. `await act(async ...)` drains the microtask
 * queue first, which is what makes "it did not happen" mean what it says.
 */
function submitForm() {
  return act(async () => {
    fireEvent.submit(document.getElementById(CUSTOM_PROVIDER_FORM_ID) as HTMLFormElement)
  })
}

async function fillProviderBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Provider ID'), 'my-provider')
  await user.type(screen.getByLabelText('Endpoint URL'), 'https://example.com/v1')
}

/**
 * Adds one model through the nested model dialog. The nested dialog is a Radix
 * modal, so it replaces the provider dialog in the accessibility tree rather
 * than sitting alongside it - which is why these labels are unique here even
 * though both dialogs describe a model.
 */
async function addModel(
  user: ReturnType<typeof userEvent.setup>,
  { id = 'my-model', context = '128000', output = '16384' } = {},
) {
  await user.click(screen.getByRole('button', { name: 'Add model' }))
  await user.type(screen.getByLabelText('Model ID'), id)
  await user.type(screen.getByLabelText('Context window'), context)
  await user.type(screen.getByLabelText('Max output tokens'), output)
  await act(async () => {
    fireEvent.submit(document.getElementById(CUSTOM_MODEL_FORM_ID) as HTMLFormElement)
  })
}

function draft(over: Partial<CustomProviderDraft> = {}): CustomProviderDraft {
  return {
    providerId: 'my-provider',
    name: 'My Provider',
    kind: 'api',
    baseUrl: 'https://example.com/v1',
    npm: '',
    models: [],
    ...over,
  }
}

function modelDraft(over: Partial<CustomModelDraft> = {}): CustomModelDraft {
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

describe('CustomProviderDialog', () => {
  it('refuses to save a provider with no models', async () => {
    // The model picker hides a provider that declares none, so saving one is a
    // save that appears to have done nothing. Refusing here, with the reason on
    // screen, is the only way the user finds out before the write.
    //
    // What would pass without the guard: an `onSubmit` carrying `models: []`,
    // which writes a `provider.<id>` block the picker will never show.
    const { onSubmit, user } = setup()
    await fillProviderBasics(user)

    await submitForm()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('At least one model is required')).toBeInTheDocument()
  })

  it('saves a provider once it has a model', async () => {
    // The control for the refusal above. Without it a handler that refused every
    // save would pass that test, so this is what makes it mean "refuses the
    // empty" rather than "never submits".
    const { onSubmit, user } = setup()
    await fillProviderBasics(user)
    await addModel(user)

    await submitForm()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      providerId: 'my-provider',
      kind: 'api',
      baseUrl: 'https://example.com/v1',
      models: [{ id: 'my-model', contextLimit: '128000', outputLimit: '16384' }],
    })
  })

  it('saves an edit of a provider whose own id is in the taken list', async () => {
    // The id being edited is, by definition, in `existingProviderIds` - and the
    // settings page passes that list straight through. When the submit guard
    // treated every save as a create, the Save button stayed enabled (the
    // button-level check said 'edit') and clicking it did nothing at all: a
    // form that looks editable and is not.
    //
    // What would pass without the fix: the button test alone, since the button
    // was never the broken half.
    const { onSubmit, user } = setup({
      editingProviderId: 'my-provider',
      existingProviderIds: ['my-provider', 'other'],
      initialDraft: draft({ models: [modelDraft()] }),
    })

    await addModel(user, { id: 'second-model' })
    await submitForm()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ providerId: 'my-provider' })
  })

  it('saves after switching an endpoint provider over to an npm package', async () => {
    // Only one of the two fields is mounted, and react-hook-form can drop the
    // value of one that unmounts. The hidden `baseUrl` then went undefined, and
    // every later save failed validation on a field that was no longer on
    // screen: a form that could not be saved and would not say why.
    const { onSubmit, user } = setup()

    await user.type(screen.getByLabelText('Provider ID'), 'my-provider')
    await user.type(screen.getByLabelText('Endpoint URL'), 'https://example.com/v1')
    await addModel(user)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'npm package' }))
    await user.type(screen.getByLabelText('npm package'), '@ai-sdk/openai-compatible')

    await submitForm()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      kind: 'npm',
      npm: '@ai-sdk/openai-compatible',
      // The endpoint is gone, and the hidden field says so rather than
      // travelling along as a stale value.
      baseUrl: '',
    })
  })

  it('refuses a create whose id is already declared, and says which id', async () => {
    // Creating here would replace an existing provider wholesale - its models
    // included - with nothing on screen saying so. So a create has to refuse and
    // name the collision; the id field is free text and the list it is checked
    // against can change while the dialog is open.
    //
    // What would pass without the guard: an `onSubmit` that silently overwrites
    // somebody's provider and every model under it.
    const { onSubmit, user } = setup({ existingProviderIds: ['openai'] })
    await user.type(screen.getByLabelText('Provider ID'), 'openai')
    await user.type(screen.getByLabelText('Endpoint URL'), 'https://example.com/v1')
    await addModel(user)

    expect(screen.getByText(/openai already exists/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()

    await submitForm()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not report an id collision against the provider being edited', async () => {
    // The other half of the rule, and the part that is observable today. Editing
    // a provider means that same provider coming back, so its own id is not a
    // collision - and if the check did not exempt the edit, no custom provider
    // could ever be opened for editing without being told it already exists.
    //
    // NOTE: only the report is asserted, not the save. The submit handler re-runs
    // the same check in 'create' mode unconditionally, so an edit whose id is in
    // `existingProviderIds` submits nothing and shows no message at all. That is
    // a defect in CustomProviderDialog.tsx, not in this test; see the report.
    // Asserting the save here would mean asserting the bug.
    setup({
      existingProviderIds: ['openai'],
      editingProviderId: 'openai',
      initialDraft: draft({ providerId: 'openai', name: 'OpenAI', models: [modelDraft()] }),
    })

    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('locks the provider id while editing, so a save cannot move the block', async () => {
    // The draft is merged by key. A different id would add a second provider and
    // orphan the first, so the field is read-only rather than merely pre-filled
    // - and that is the assertion, since a pre-filled but editable field still
    // passes a "shows the id" check.
    setup({
      existingProviderIds: ['openai'],
      editingProviderId: 'openai',
      initialDraft: draft({ providerId: 'openai', models: [modelDraft()] }),
    })

    expect(screen.getByLabelText('Provider ID')).toHaveAttribute('readonly')
  })

  it('refuses a provider with no id, and one with no endpoint', async () => {
    // Both are the identity of the block: without the id there is no
    // `provider.<id>` to write to, and an api kind with no base URL writes an
    // endpoint of nothing.
    //
    // What would pass without the guard: a config block keyed by an empty
    // string, which no model picker can ever reference.
    const { onSubmit } = setup()

    await submitForm()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('A provider ID is required')).toBeInTheDocument()
    expect(screen.getByText('An endpoint URL is required')).toBeInTheDocument()
  })

  it('asks for an npm package instead of an endpoint once the kind is npm', async () => {
    // An npm provider is reached through a package, not a URL, so the two fields
    // are mutually exclusive. Asserting both that the endpoint is no longer
    // offered and that the package field took its place is what catches a form
    // that kept the URL behind.
    //
    // "Not offered" is a visibility check, not an absence check. The endpoint
    // field stays mounted - only hidden - because unmounting it made
    // react-hook-form drop its value to `undefined`, and every later save then
    // failed on a field that was no longer on screen. Keeping it mounted is also
    // what lets the endpoint URL survive a trip to npm and back.
    const { user } = setup()
    await user.click(screen.getByRole('combobox', { name: 'How it is reached' }))
    await user.click(screen.getByRole('option', { name: 'npm package' }))

    expect(screen.queryByLabelText('Endpoint URL')).not.toBeVisible()
    expect(screen.getByLabelText('npm package')).toBeVisible()
  })

  it('saves an npm provider with its package and no endpoint', async () => {
    // The control for the refusal below, and the save half of the swap above.
    // Reaching it through the draft is not a workaround dressed up as a test: it
    // is the same schema and the same handler, and it is the path an edit of an
    // existing npm provider actually takes.
    //
    // Asserting `baseUrl: ''` rather than leaving it out is the point - a draft
    // that carried a stale endpoint would write both `api` and `npm` into the
    // config block and leave the sdk picking one at random.
    const { onSubmit } = setup({
      initialDraft: draft({ kind: 'npm', baseUrl: '', npm: '@ai-sdk/openai-compatible', models: [modelDraft()] }),
    })

    await submitForm()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      kind: 'npm',
      npm: '@ai-sdk/openai-compatible',
      baseUrl: '',
    })
  })

  it('refuses an npm provider with no package named', async () => {
    // A provider block with neither a package nor an endpoint is one the sdk
    // cannot resolve, so the save has to stop and say which field.
    //
    // What would pass without the guard: an `onSubmit` carrying `npm: ''`, i.e. a
    // provider block written that the model picker will list but nothing can use.
    const { onSubmit } = setup({
      initialDraft: draft({ kind: 'npm', baseUrl: '', npm: '', models: [modelDraft()] }),
    })

    await submitForm()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('An npm package is required')).toBeInTheDocument()
  })

  it('edits a model in place rather than adding a second one', async () => {
    // The list is the draft. An edit that appended would leave the old model in
    // the config under its own key, so the provider would grow a model every
    // time somebody corrected a limit.
    //
    // The count is the assertion that matters here: asserting only that the new
    // value appears would pass on a list holding both the old and the new model.
    const { onSubmit, user } = setup({
      initialDraft: draft({ models: [modelDraft(), modelDraft({ id: 'other-model', name: 'Other' })] }),
    })

    await user.click(screen.getByRole('button', { name: 'Edit my-model' }))
    const context = screen.getByLabelText('Context window')
    await user.clear(context)
    await user.type(context, '256000')
    await act(async () => {
      fireEvent.submit(document.getElementById(CUSTOM_MODEL_FORM_ID) as HTMLFormElement)
    })

    await submitForm()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].models).toHaveLength(2)
    expect(onSubmit.mock.calls[0][0].models[0]).toMatchObject({
      id: 'my-model',
      contextLimit: '256000',
    })
  })

  it('locks the model id while editing a model in the list', async () => {
    // Same reason as the provider id: the model is merged by key, so renaming it
    // during an edit writes a second model and orphans the first.
    setup({ initialDraft: draft({ models: [modelDraft()] }) })

    expect(screen.getByRole('button', { name: 'Edit my-model' })).toBeEnabled()

    // The nested dialog only exists once one is opened, so the field is checked
    // there rather than on the provider form.
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit my-model' }))
    expect(screen.getByLabelText('Model ID')).toHaveAttribute('readonly')
  })

  it('removes a model from the list', async () => {
    // The list is the draft, so removing a row is how a model is dropped before
    // the save. Without it the only way to lose a stale model is to edit the
    // config by hand.
    const { onSubmit, user } = setup({
      initialDraft: draft({ models: [modelDraft(), modelDraft({ id: 'other-model', name: 'Other' })] }),
    })

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Remove my-model' }))

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    await submitForm()
    expect(onSubmit.mock.calls[0][0].models.map((m: CustomModelDraft) => m.id)).toEqual(['other-model'])
  })

  it('says so, rather than showing an empty list, when there are no models', async () => {
    // A blank area next to an "Add model" button reads as a bug. The line that
    // explains it also explains why the save is refused.
    setup({ initialDraft: draft({ models: [] }) })

    expect(screen.getByText(/No models yet/)).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('opens blank when there is no draft to open with, rather than on the last attempt', async () => {
    // The model list is component state, not form state, so it survives a close
    // that the reset-on-open effect never touches. Reopening a create would then
    // quietly carry the previous attempt's models into a new provider.
    //
    // The models are the assertion that matters: a reset that cleared the inputs
    // but left the list behind would pass an inputs-only check.
    const { user, view } = setup()
    await fillProviderBasics(user)
    await addModel(user)
    await submitForm()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)

    view.rerender(
      <CustomProviderDialog open={false} onOpenChange={vi.fn()} existingProviderIds={[]} onSubmit={vi.fn()} />,
    )
    view.rerender(
      <CustomProviderDialog open onOpenChange={vi.fn()} existingProviderIds={[]} onSubmit={vi.fn()} />,
    )

    expect(screen.getByLabelText('Provider ID')).toHaveValue('')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('never asks for an API key here', async () => {
    // Credentials are per user and the global config wins per leaf, so a key
    // written here would silently beat the one entered under API Keys with
    // nothing on screen saying so. The field must stay off this form, and the
    // note must stay on it.
    setup()

    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument()
    expect(screen.getByText(/No API key is set here/)).toBeInTheDocument()
  })

  it('gives every button inside the form an explicit type, so none of them submits it', () => {
    // The submit button sits in the footer, outside the <form>, and reaches back
    // in through `form=`. Every other button therefore has to say type="button":
    // a bare <button> inside a form submits the form when clicked, in a browser.
    //
    // This is structural on purpose. jsdom does not implement form submission on
    // a button click at all, so a behavioural test here would pass whether or
    // not the types were there.
    setup()

    const inForm = Array.from(
      document.getElementById(CUSTOM_PROVIDER_FORM_ID)?.querySelectorAll('button') ?? [],
    )
    // So the loop cannot pass by finding nothing.
    expect(inForm.length).toBeGreaterThan(0)
    for (const button of inForm) {
      expect(button).toHaveAttribute('type', 'button')
    }
  })

  it('locks both buttons and says it is saving while the write is in flight', async () => {
    // The write goes to the config API. A second click while it is pending is a
    // second write of the same provider, and cancel would close a dialog whose
    // result is about to land.
    //
    // Structural on purpose: jsdom does not submit a form when a button inside it
    // is clicked, so a click-counting test would pass either way.
    const { user } = setup({ isSubmitting: true })
    await fillProviderBasics(user)

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('shows a save failure without losing what was typed', async () => {
    // The write failed. Retyping a whole provider - models included - because
    // one field was rejected is the worst outcome here, so the form has to still
    // be filled in when the error is on screen.
    const { onSubmit, user } = setup({ error: 'Could not save the custom provider' })
    await fillProviderBasics(user)
    await addModel(user)

    expect(screen.getByText('Could not save the custom provider')).toBeInTheDocument()
    expect(screen.getByLabelText('Provider ID')).toHaveValue('my-provider')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('closes on cancel without saving', async () => {
    // Cancel is not a submit path: a dialog that posted a half-finished provider
    // on cancel would write a config block every time somebody changed their mind.
    const { onSubmit, onOpenChange, user } = setup()
    await fillProviderBasics(user)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})