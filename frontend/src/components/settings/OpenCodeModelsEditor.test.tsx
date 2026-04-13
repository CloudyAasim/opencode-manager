import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OpenCodeModelsEditor } from './OpenCodeModelsEditor'
import type { ConfigProvider, ConfigModel } from './OpenCodeModelsEditor'

const mockProviders: Record<string, ConfigProvider> = {
  openai: {
    name: 'OpenAI',
    models: {
      'gpt-4o': {
        name: 'GPT-4o',
        limit: { context: 128000, output: 4096 },
      },
    },
  },
  anthropic: {
    name: 'Anthropic',
    models: {
      'claude-3-5-sonnet': {
        name: 'Claude 3.5 Sonnet',
        limit: { context: 200000, output: 8192 },
      },
    },
  },
}

describe('OpenCodeModelsEditor', () => {
  describe('rendering', () => {
    it('should render empty state when no providers configured', () => {
      const onChange = vi.fn()
      render(<OpenCodeModelsEditor providers={{}} onChange={onChange} />)

      expect(screen.getByText(/No models configured/)).toBeInTheDocument()
      expect(screen.getByText(/Add your first model to get started/)).toBeInTheDocument()
    })

    it('should render provider groups with model counts', () => {
      const onChange = vi.fn()
      render(<OpenCodeModelsEditor providers={mockProviders} onChange={onChange} />)

      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('Anthropic')).toBeInTheDocument()
      const modelCountSpans = screen.getAllByText(/\(1 model\)/)
      expect(modelCountSpans.length).toBe(2)
    })

    it('should render model entries with display names and IDs', () => {
      const onChange = vi.fn()
      render(<OpenCodeModelsEditor providers={mockProviders} onChange={onChange} />)

      expect(screen.getByText('GPT-4o')).toBeInTheDocument()
      expect(screen.getByText('gpt-4o')).toBeInTheDocument()
      expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument()
      expect(screen.getByText('claude-3-5-sonnet')).toBeInTheDocument()
    })

    it('should render model limits when present', () => {
      const onChange = vi.fn()
      render(<OpenCodeModelsEditor providers={mockProviders} onChange={onChange} />)

      expect(screen.getByText(/Context 128000/)).toBeInTheDocument()
      expect(screen.getByText(/Output 4096/)).toBeInTheDocument()
    })
  })

  describe('delete model', () => {
    it('should call onChange with updated providers when model is deleted', () => {
      const onChange = vi.fn()
      render(<OpenCodeModelsEditor providers={mockProviders} onChange={onChange} />)

      const deleteButtons = document.querySelectorAll('button')
      let deleteButton: HTMLButtonElement | null = null
      deleteButtons.forEach(btn => {
        const svg = btn.querySelector('svg')
        if (svg && svg.className.baseVal.includes('Trash2')) {
          deleteButton = btn as HTMLButtonElement
        }
      })

      expect(deleteButton).not.toBeNull()
      if (deleteButton) {
        fireEvent.click(deleteButton)
      }

      expect(onChange).toHaveBeenCalled()
      const updatedProviders = onChange.mock.calls[0][0]
      expect(updatedProviders.openai).toBeDefined()
      expect(updatedProviders.openai.models).toBeDefined()
    })
  })

  describe('model content structure', () => {
    it('should preserve provider structure when models change', () => {
      const onChange = vi.fn()
      const providersWithExtras: Record<string, ConfigProvider> = {
        openai: {
          name: 'OpenAI',
          api: 'https://api.openai.com',
          npm: '@opencode-manager/provider-openai',
          models: {
            'gpt-4o': {
              name: 'GPT-4o',
            },
          },
        },
      }

      render(<OpenCodeModelsEditor providers={providersWithExtras} onChange={onChange} />)

      const deleteButtons = document.querySelectorAll('button')
      let deleteButton: HTMLButtonElement | null = null
      deleteButtons.forEach(btn => {
        const svg = btn.querySelector('svg')
        if (svg && svg.className.baseVal.includes('Trash2')) {
          deleteButton = btn as HTMLButtonElement
        }
      })

      if (deleteButton) {
        fireEvent.click(deleteButton)
      }

      expect(onChange).toHaveBeenCalled()
      const updatedProviders = onChange.mock.calls[0][0]
      expect(updatedProviders.openai.name).toBe('OpenAI')
      expect(updatedProviders.openai.api).toBe('https://api.openai.com')
      expect(updatedProviders.openai.npm).toBe('@opencode-manager/provider-openai')
    })
  })
})

describe('OpenCodeModelDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    availableProviders: ['openai', 'anthropic'],
    selectedProviderId: 'openai',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('form validation', () => {
    it('should require model id when submitting empty form', async () => {
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} />)

      const createButton = screen.getByRole('button', { name: /create/i })
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(screen.getByText(/model id is required/i)).toBeInTheDocument()
      })
    })

    it('should require display name when submitting empty form', async () => {
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} />)

      const createButton = screen.getByRole('button', { name: /create/i })
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(screen.getByText(/display name is required/i)).toBeInTheDocument()
      })
    })

    it('should validate model id format', async () => {
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} />)

      const modelIdInput = document.querySelector('input[name="modelId"]') as HTMLInputElement
      if (modelIdInput) {
        fireEvent.change(modelIdInput, { target: { value: 'invalid model id!' } })
        const createButton = screen.getByRole('button', { name: /create/i })
        fireEvent.click(createButton)

        await waitFor(() => {
          expect(screen.getByText(/alphanumeric/i)).toBeInTheDocument()
        })
      }
    })
  })

  describe('form submission', () => {
    it('should call onSubmit with correct provider id, model id, and model data', async () => {
      const onSubmit = vi.fn()
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} onSubmit={onSubmit} />)

      const modelIdInput = document.querySelector('input[name="modelId"]') as HTMLInputElement
      const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement

      if (modelIdInput && nameInput) {
        fireEvent.change(modelIdInput, { target: { value: 'gpt-5' } })
        fireEvent.change(nameInput, { target: { value: 'GPT-5' } })
      }

      const createButton = screen.getByRole('button', { name: /create/i })
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          'openai',
          'gpt-5',
          expect.objectContaining({
            name: 'GPT-5',
          })
        )
      })
    })

    it('should include limit data when provided', async () => {
      const onSubmit = vi.fn()
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} onSubmit={onSubmit} />)

      const modelIdInput = document.querySelector('input[name="modelId"]') as HTMLInputElement
      const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement
      const contextLimitInput = document.querySelector('input[name="contextLimit"]') as HTMLInputElement
      const outputLimitInput = document.querySelector('input[name="outputLimit"]') as HTMLInputElement

      if (modelIdInput && nameInput && contextLimitInput && outputLimitInput) {
        fireEvent.change(modelIdInput, { target: { value: 'gpt-5' } })
        fireEvent.change(nameInput, { target: { value: 'GPT-5' } })
        fireEvent.change(contextLimitInput, { target: { value: '256000' } })
        fireEvent.change(outputLimitInput, { target: { value: '8192' } })
      }

      const createButton = screen.getByRole('button', { name: /create/i })
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          'openai',
          'gpt-5',
          expect.objectContaining({
            name: 'GPT-5',
            limit: {
              context: 256000,
              output: 8192,
            },
          })
        )
      })
    })
  })

  describe('edit mode', () => {
    it('should pre-fill form with existing model data', async () => {
      const editingModel = {
        providerId: 'openai',
        modelId: 'gpt-4o',
        model: {
          name: 'GPT-4o',
          limit: { context: 128000, output: 4096 },
        } as ConfigModel,
      }

      const onSubmit = vi.fn()
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(
        <OpenCodeModelDialog
          {...defaultProps}
          onSubmit={onSubmit}
          editingModel={editingModel}
          open={true}
        />
      )

      expect(screen.getByDisplayValue('GPT-4o')).toBeInTheDocument()
      expect(screen.getByDisplayValue('gpt-4o')).toBeInTheDocument()
    })

    it('should emit Update button text when editing', async () => {
      const editingModel = {
        providerId: 'openai',
        modelId: 'gpt-4o',
        model: {
          name: 'GPT-4o',
        } as ConfigModel,
      }

      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(
        <OpenCodeModelDialog
          {...defaultProps}
          editingModel={editingModel}
          open={true}
        />
      )

      expect(screen.getByRole('button', { name: /update/i })).toBeInTheDocument()
    })

    it('should preserve the original backing model id when renaming a model key', async () => {
      const editingModel = {
        providerId: 'openai',
        modelId: 'gpt-4o',
        model: {
          name: 'GPT-4o',
          limit: { context: 128000, output: 4096 },
          reasoning: true,
        } as ConfigModel,
      }

      const onSubmit = vi.fn()
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(
        <OpenCodeModelDialog
          {...defaultProps}
          onSubmit={onSubmit}
          editingModel={editingModel}
          open={true}
        />
      )

      fireEvent.change(document.querySelector('input[name="modelId"]') as HTMLInputElement, {
        target: { value: 'my-friendly-model' },
      })

      fireEvent.click(screen.getByRole('button', { name: /update/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          'openai',
          'my-friendly-model',
          expect.objectContaining({
            id: 'gpt-4o',
            name: 'GPT-4o',
            reasoning: true,
          })
        )
      })
    })
  })
})
