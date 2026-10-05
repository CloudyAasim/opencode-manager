import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomProviderDialog } from './CustomProviderDialog'
import type { CustomProviderDraft } from './custom-provider'

type Setup = Partial<React.ComponentProps<typeof CustomProviderDialog>>

// jsdom implements neither the pointer capture methods nor PointerEvent, and
// Radix Select's item handler calls `hasPointerCapture` on whatever the pointer
// landed on. Stubbed here rather than in the shared setup file so the
// workaround stays next to the only tests that need it, and so it is obvious
// this is a jsdom gap rather than something the component does.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
})

function setup(props: Setup = {}) {
  const onSubmit = vi.fn()
  const view = render(
    <CustomProviderDialog
      open
      onOpenChange={vi.fn()}
      existingProviderIds={[]}
      onSubmit={onSubmit}
      {...props}
    />,
  )
  return { onSubmit, user: userEvent.setup(), view }
}

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Provider ID'), 'my-provider')
  await user.type(screen.getByLabelText('Endpoint URL'), 'https://example.com/v1')
  await user.type(screen.getByLabelText('Model ID'), 'my-model')
}

const create = () => screen.getByRole('button', { name: 'Create' })

describe('CustomProviderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits a complete draft', async () => {
    const { onSubmit, user } = setup()
    await fillBasics(user)

    await user.click(create())

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0] as CustomProviderDraft).toEqual({
      providerId: 'my-provider',
      name: undefined,
      kind: 'api',
      baseUrl: 'https://example.com/v1',
      npm: undefined,
      models: [{ id: 'my-model', name: undefined }],
    })
  })

  it('says the key is set elsewhere, and does not ask for one here', async () => {
    // The positive half of the rule: the dialog has to both state it and stay
    // a form with no key field on it.
    setup()

    expect(screen.getByText(/No API key is set here/)).toBeInTheDocument()
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
  })

  it('does not submit the form when the dropdown is opened', async () => {
    // Picking from the dropdown is an ordinary click on a control that lives
    // inside the form, so this is where the form would submit by accident if it
    // were going to. It must not: the form is half-filled here, and the outcome
    // would be a panel of validation errors instead of the two options.
    //
    // The teeth are thin on their own - jsdom does not submit a form when a
    // button inside it is clicked - so the test below is what pins it.
    const { onSubmit, user } = setup()

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'npm package' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.queryByText('A provider ID is required')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveTextContent('npm package')
  })

  it('asks for a package instead of an endpoint once the kind is npm', async () => {
    const { onSubmit, user } = setup()
    await user.type(screen.getByLabelText('Provider ID'), 'my-provider')
    await user.type(screen.getByLabelText('Model ID'), 'my-model')

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'npm package' }))
    await user.type(screen.getByLabelText('npm package'), '@ai-sdk/openai-compatible')

    expect(screen.queryByLabelText('Endpoint URL')).not.toBeInTheDocument()

    await user.click(create())

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect((onSubmit.mock.calls[0][0] as CustomProviderDraft).npm).toBe('@ai-sdk/openai-compatible')
  })

  it('gives every button inside the form an explicit type, so none of them submits it', () => {
    // The submit button sits in the footer, outside the <form>, and reaches back
    // in through `form=`. Every other button therefore has to say type="button":
    // a bare <button> inside a form submits the form when clicked, in a browser.
    //
    // This is the only assertion in the file with any teeth on that rule, and it
    // is a structural one on purpose. jsdom does not implement form submission
    // on a button click at all, so the behavioural test above passes with or
    // without the types and cannot tell the difference.
    //
    // The combobox is in this set too. Radix renders its own trigger as
    // `<button type="button">`; if a Radix upgrade ever stopped doing that, this
    // is where it would surface, which is the outcome worth failing on.
    setup()

    const inForm = Array.from(
      document.getElementById('custom-provider-form')?.querySelectorAll('button') ?? [],
    )
    // So the loop cannot pass by finding nothing.
    expect(inForm.length).toBeGreaterThan(0)
    for (const button of inForm) {
      expect(button).toHaveAttribute('type', 'button')
    }
  })

  it('will not submit when the id is already claimed', async () => {
    // The button is disabled once the id shows as taken, but a disabled button
    // is not the only way a form can be submitted, so the guard in the submit
    // handler is the line that has to hold.
    //
    // Fired directly rather than by pressing Enter or clicking, because jsdom
    // implements neither implicit submission on Enter nor submission on a button
    // click - both of those tests pass with the guard deleted.
    //
    // The `act` is load-bearing, and this test was wrong without it.
    // react-hook-form's handleSubmit is async, so a bare
    // `expect(onSubmit).not.toHaveBeenCalled()` on the line after `fireEvent`
    // runs before the handler has had any chance to, and passes with the guard
    // deleted. `await act(async ...)` drains the microtask queue first, which is
    // what makes "it did not happen" mean what it says.
    //
    // Set up with the id already claimed rather than claiming it halfway
    // through. Rerendering mid-test re-runs the reset-on-open effect, and a
    // form that has just been reset fails validation, so the handler's callback
    // never runs and the assertion would be about an empty form.
    const { onSubmit, user } = setup({ existingProviderIds: ['my-provider'] })
    await fillBasics(user)

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()

    await act(async () => {
      fireEvent.submit(document.getElementById('custom-provider-form') as HTMLFormElement)
    })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does submit from the same path once the id is free', async () => {
    // The control for the one above: same event, same handler, and it goes
    // through. Without this, a handler that refused everything would pass.
    const { onSubmit, user } = setup()
    await fillBasics(user)

    fireEvent.submit(document.getElementById('custom-provider-form') as HTMLFormElement)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect((onSubmit.mock.calls[0][0] as CustomProviderDraft).providerId).toBe('my-provider')
  })

  it('refuses a provider id that is already declared, and does not send anything', async () => {
    // A create that overwrote an existing provider would replace its models
    // too, silently. Paired with the free-id case below, which a dialog that
    // refused everything would also pass.
    const { onSubmit, user } = setup({ existingProviderIds: ['openai'] })
    await user.type(screen.getByLabelText('Provider ID'), 'openai')
    await user.type(screen.getByLabelText('Endpoint URL'), 'https://example.com/v1')
    await user.type(screen.getByLabelText('Model ID'), 'my-model')

    expect(screen.getByText(/openai already exists/)).toBeInTheDocument()
    expect(create()).toBeDisabled()

    await user.click(create())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('leaves a free id enabled', async () => {
    const { user } = setup({ existingProviderIds: ['openai'] })
    await user.type(screen.getByLabelText('Provider ID'), 'brand-new')

    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument()
    expect(create()).toBeEnabled()
  })

  it('will not submit an incomplete form, and says which field', async () => {
    const { onSubmit, user } = setup()

    await user.click(create())

    expect(onSubmit).not.toHaveBeenCalled()
    expect(await screen.findByText('A provider ID is required')).toBeInTheDocument()
    expect(screen.getByText('An endpoint URL is required')).toBeInTheDocument()
    expect(screen.getByText('A model ID is required')).toBeInTheDocument()
  })

  it('collects more than one model', async () => {
    const { onSubmit, user } = setup()
    await fillBasics(user)

    await user.click(screen.getByRole('button', { name: 'Add model' }))
    const modelIds = screen.getAllByLabelText('Model ID')
    await user.type(modelIds[1], 'second-model')

    await user.click(create())

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect((onSubmit.mock.calls[0][0] as CustomProviderDraft).models.map((m) => m.id))
      .toEqual(['my-model', 'second-model'])
  })

  it('refuses two models with the same id', async () => {
    const { onSubmit, user } = setup()
    await fillBasics(user)
    await user.click(screen.getByRole('button', { name: 'Add model' }))
    await user.type(screen.getAllByLabelText('Model ID')[1], 'my-model')

    await user.click(create())

    expect(onSubmit).not.toHaveBeenCalled()
    expect(await screen.findByText(/is used more than once/)).toBeInTheDocument()
  })

  it('removes a model row, and offers no way to remove the last one', async () => {
    const { onSubmit, user } = setup()
    await fillBasics(user)

    // One row: there is nothing to remove, and saying so with a disabled button
    // beats a list that can be emptied into an invalid form.
    expect(screen.getByRole('button', { name: 'Remove model' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Add model' }))
    await user.type(screen.getAllByLabelText('Model ID')[1], 'second-model')
    const removeButtons = screen.getAllByRole('button', { name: 'Remove model' })
    expect(removeButtons[0]).toBeEnabled()

    await user.click(removeButtons[1])
    await user.click(create())

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect((onSubmit.mock.calls[0][0] as CustomProviderDraft).models).toHaveLength(1)
  })

  it('starts blank every time it is opened, rather than showing the last attempt', async () => {
    const { view, user } = setup()
    await user.type(screen.getByLabelText('Provider ID'), 'half-typed')
    await user.click(create())
    expect(await screen.findByText('An endpoint URL is required')).toBeInTheDocument()

    view.rerender(
      <CustomProviderDialog open={false} onOpenChange={vi.fn()} existingProviderIds={[]} onSubmit={vi.fn()} />,
    )
    view.rerender(
      <CustomProviderDialog open onOpenChange={vi.fn()} existingProviderIds={[]} onSubmit={vi.fn()} />,
    )

    // A stale form that happens to be blank would pass this; the error the
    // previous attempt raised is the part that has to be gone.
    await waitFor(() => {
      expect(screen.getByLabelText('Provider ID')).toHaveValue('')
    })
    expect(screen.getByLabelText('Model ID')).toHaveValue('')
    expect(screen.queryByText('An endpoint URL is required')).not.toBeInTheDocument()
  })

  it('shows a save failure without losing what was typed', async () => {
    const { user } = setup({ error: 'Could not create the custom provider' })
    await fillBasics(user)

    expect(screen.getByText('Could not create the custom provider')).toBeInTheDocument()
    expect(screen.getByLabelText('Provider ID')).toHaveValue('my-provider')
  })

  it('disables both buttons while the write is in flight', async () => {
    const { user } = setup({ isSubmitting: true })
    await fillBasics(user)

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Creating...' })).toBeDisabled()
  })
})
