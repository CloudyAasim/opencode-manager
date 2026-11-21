import { API_BASE_URL } from "@/config";
import { settingsApi } from "./settings";
import { fetchWrapper } from "./fetchWrapper";
import { createBffClient } from "./bff";
import type { OpenCodeConfigFile } from "./types/settings";
import type { Model, Provider as VersionedProvider } from "@opencode-manager/shared/api/v1";
import type { QueryClient } from "@tanstack/react-query";

export type { Model };

/**
 * Where a provider came from, as the client can tell.
 *
 * The agent's catalogue does not say: it says which providers are connected,
 * not which of them the person wrote down. The client works that out from the
 * configuration file, which is the manager's own business.
 */
export type ProviderSource = "configured" | "local" | "builtin";

/**
 * A provider of models.
 *
 * The provider and its models are the versioned API's - there is one truth
 * about what a model is, and the client does not get to have its own. What the
 * client adds is the one thing the catalogue cannot say: where the provider
 * came from.
 */
export interface Provider extends VersionedProvider {
  source?: ProviderSource;
}

/**
 * A provider, and where it came from.
 *
 * The configuration file knows two things the catalogue does not: the address
 * the provider's own API is at, and the package that API comes from. Both are
 * the person's own settings, so both stay on this side of the line.
 */
export interface ProviderWithModels extends Provider {
  /** The address the provider's own API is at, when the configuration says so. */
  api?: string;
  /** The package the provider's API comes from, when the configuration says so. */
  npm?: string;
  source: ProviderSource;
}

export interface ModelSelection {
  providerID: string;
  modelID: string;
}

export interface OpenCodeModelState {
  recent: ModelSelection[];
  favorite: ModelSelection[];
  variant: Record<string, string | undefined>;
}

interface ConfigProvider {
  npm?: string;
  name?: string;
  api?: string;
  options?: {
    baseURL?: string;
    [key: string]: unknown;
  };
  models?: Record<string, ConfigModel>;
}

interface ConfigModel {
  id?: string;
  name?: string;
  limit?: {
    context?: number;
    output?: number;
  };
  modalities?: {
    input?: ("text" | "audio" | "image" | "video" | "pdf")[];
    output?: ("text" | "audio" | "image" | "video" | "pdf")[];
  };
  variants?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

const LOCAL_PROVIDER_IDS = ["ollama", "lmstudio", "llamacpp", "jan"];

function classifyProviderSource(providerId: string, isFromConfig: boolean): ProviderSource {
  if (!isFromConfig) return "builtin";
  if (LOCAL_PROVIDER_IDS.includes(providerId.toLowerCase())) return "local";
  return "configured";
}

/**
 * The provider with this name, if the catalogue has it.
 *
 * A provider is named by one thing and the catalogue is a list, so "which one
 * is it" is one question with one answer. It is asked in one place because a
 * client that asks it in eight places ends up with eight answers - and one of
 * them was a dictionary lookup on a list, which never finds anything.
 */
export function findProvider(providers: Provider[], providerID: string): Provider | undefined {
  return providers.find((provider) => provider.id === providerID);
}

/**
 * The model a provider knows by this name.
 *
 * A model has one name: the one it is known by inside its provider, which is
 * also the name a conversation is started with. The catalogue used to carry a
 * second name for the same model - the one the provider's own API knows it by
 * - and a client that held both had to guess which of them a conversation
 * wanted.
 */
export function findModel(provider: Provider, modelID: string): Model | undefined {
  return provider.models.find((model) => model.id === modelID);
}

/**
 * The model a selection names, if the catalogue still has it.
 *
 * A selection names two things: the provider the model belongs to, and the name
 * it is known by inside it. Both are needed to find it, and both are the
 * layer's own words - the catalogue speaks them, so the client may not answer
 * with a shape of its own.
 *
 * The answer carries the provider as well, because the places that ask for a
 * model usually need to say which provider it belongs to.
 */
export interface SelectedModel {
  provider: Provider;
  model: Model;
}

export function findSelectedModel(
  providers: Provider[],
  providerID: string,
  modelID: string,
): SelectedModel | undefined {
  const provider = findProvider(providers, providerID);
  if (!provider) return undefined;
  const model = findModel(provider, modelID);
  return model ? { provider, model } : undefined;
}

export interface ProvidersResult {
  providers: Provider[];
  connected: string[];
  default: Record<string, string>;
}

/**
 * Where the catalogue is filed.
 *
 * The catalogue comes from the layer the client talks to, so the slot is filed
 * under its name. It used to be filed under the agent's own name and address,
 * which is where it went to be asked for before it moved to the layer.
 */
export const PROVIDERS_QUERY_PREFIX = ["bff", "providers"] as const;

export function providersQueryKey(
  serverUrl: string | null | undefined,
  directory: string | null | undefined,
) {
  return [...PROVIDERS_QUERY_PREFIX, serverUrl, directory];
}

/**
 * The catalogue, as it is cached.
 *
 * The client asks for the catalogue in several places, and the one that checks
 * whether a picked model is still available reads it out of the cache instead
 * of asking again - it is megabytes long and it was just fetched.
 *
 * So the slot is read here, in the shape the layer speaks. A client that read
 * it with a shape of its own could answer with one that has gone out of date,
 * and did: the check looked the model up in a dictionary while the catalogue's
 * models are a list, so it always answered "no" and refused every prompt sent
 * with a model.
 */
export function readCatalogue(
  queryClient: QueryClient,
  serverUrl: string | null | undefined,
  directory: string | null | undefined,
): ProvidersResult | undefined {
  return queryClient.getQueryData<ProvidersResult>(providersQueryKey(serverUrl, directory));
}

/**
 * The catalogue of models, as this layer answers it.
 *
 * The client used to ask the agent for this itself, by building the agent's
 * own path, and it got the agent's own catalogue back: megabytes long, in the
 * agent's vocabulary, and with the provider's credentials in it. Now it asks
 * the layer the client talks to, which asks the agent in the agent's dialect
 * and hands back the versioned one.
 */
export async function getProviders(directory?: string): Promise<ProvidersResult> {
  try {
    const response = await createBffClient(API_BASE_URL).listProviders(
      directory ? [directory] : [],
    );

    const providers = response.providers ?? [];

    return {
      providers,
      // Which providers are ready to be used is a fact about each provider,
      // so it travels with it. The list of names is only a convenience for
      // the places that ask "is this one connected?" once.
      connected: providers.filter((provider) => provider.connected).map((provider) => provider.id),
      default: response.default ?? {},
    };
  } catch {
    void 0
  }

  return { providers: [], connected: [], default: {} };
}

export async function getOpenCodeModelState(): Promise<OpenCodeModelState> {
  return await fetchWrapper<OpenCodeModelState>(`${API_BASE_URL}/api/providers/model-state`);
}

export async function addOpenCodeRecentModel(model: ModelSelection): Promise<OpenCodeModelState> {
  return await fetchWrapper<OpenCodeModelState>(`${API_BASE_URL}/api/providers/model-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recent: model }),
  });
}

export async function removeOpenCodeRecentModel(model: ModelSelection): Promise<OpenCodeModelState> {
  return await fetchWrapper<OpenCodeModelState>(`${API_BASE_URL}/api/providers/model-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeRecent: model }),
  });
}

export async function toggleOpenCodeFavoriteModel(model: ModelSelection): Promise<OpenCodeModelState> {
  return await fetchWrapper<OpenCodeModelState>(`${API_BASE_URL}/api/providers/model-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite: model }),
  });
}

/**
 * The providers the person wrote down.
 *
 * These are not the agent's catalogue - they are the configuration file's own
 * providers, and the two are merged afterwards. A model the configuration file
 * describes is a model the file says nothing about except its name and its
 * limits, so everything else about it is unknown rather than absent.
 */
function buildConfiguredProviders(connectedIds: Set<string>, config: OpenCodeConfigFile): ProviderWithModels[] {
  if (!config.content.provider) return [];

  const configProviders = config.content.provider as Record<string, ConfigProvider>;
  const result: ProviderWithModels[] = [];

  for (const [providerId, providerConfig] of Object.entries(configProviders)) {
    if (!providerConfig || typeof providerConfig !== "object") continue;

    const source = classifyProviderSource(providerId, true);
    const models: Model[] = [];

    if (providerConfig.models) {
      for (const [modelId, modelConfig] of Object.entries(providerConfig.models)) {
        if (!modelConfig || typeof modelConfig !== "object") continue;

        models.push({
          // The key is the model's name - the same name the catalogue would
          // give it, because that is the name a conversation is started with.
          id: modelId,
          name: modelConfig.name || modelId,
          limit: modelConfig.limit
            ? {
                context: modelConfig.limit.context || 0,
                output: modelConfig.limit.output || 0,
              }
            : null,
          cost: null,
          capabilities: null,
          modalities: modelConfig.modalities
            ? {
                input: modelConfig.modalities.input ?? [],
                output: modelConfig.modalities.output ?? [],
              }
            : null,
          variants: modelConfig.variants ?? null,
        });
      }
    }

    result.push({
      id: providerId,
      name: providerConfig.name || providerId,
      env: [],
      models,
      connected: connectedIds.has(providerId),
      api: providerConfig.api || providerConfig.options?.baseURL,
      npm: providerConfig.npm,
      source,
    });
  }

  return result;
}

export async function getProvidersWithModels(directory?: string, config?: OpenCodeConfigFile): Promise<ProviderWithModels[]> {
  // The provider list and the config file are independent, and when the caller
  // had not loaded the config this used to fetch it again inside the second
  // step - three round trips in a row before a model could be picked. Ask for
  // both at once, and fall back to just the builtin providers if the config
  // read fails rather than losing the list entirely.
  const [builtin, resolvedConfig] = await Promise.all([
    getProviders(directory),
    config ? Promise.resolve(config) : settingsApi.getOpenCodeConfig().catch(() => null),
  ]);
  const { providers: builtinProviders, connected } = builtin;
  const connectedIds = new Set(connected);

  const configuredProviders = resolvedConfig
    ? buildConfiguredProviders(connectedIds, resolvedConfig)
    : [];
  const configuredIds = new Set(configuredProviders.map((p) => p.id));

  // The catalogue's models are already in the versioned dialect, so they are
  // handed over as they are. Re-keying them here is what used to give the
  // same model two names.
  const builtinResult: ProviderWithModels[] = builtinProviders
    .filter((provider) => !configuredIds.has(provider.id))
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      env: provider.env || [],
      models: provider.models,
      connected: provider.connected,
      source: "builtin" as ProviderSource,
    }));

  const allProviders = [...configuredProviders, ...builtinResult];

  allProviders.sort((a, b) => {
    if (a.connected !== b.connected) {
      return a.connected ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return allProviders;
}

export async function getModel(
  providerId: string,
  modelId: string,
  directory?: string,
): Promise<Model | null> {
  const providers = await getProvidersWithModels(directory);
  const found = findSelectedModel(providers, providerId, modelId);

  return found?.model ?? null;
}

export function formatModelName(model: Model): string {
  return model.name || model.id;
}

export function formatProviderName(
  provider: Provider | ProviderWithModels,
): string {
  return provider.name || provider.id;
}

/**
 * The credentials of the providers.
 *
 * They used to be asked for at the manager's own doors, which answered in the
 * manager's older words. Now they are asked for at the layer the client talks
 * to, which answers in the versioned ones.
 *
 * There is no separate door for "does this one have credentials": the list
 * says which providers do, and asking again would be the same question twice.
 */
export const providerCredentialsApi = {
  list: async (): Promise<string[]> => {
    const answer = await createBffClient(API_BASE_URL).listProviderCredentials();
    return answer.credentials ?? [];
  },

  set: async (providerId: string, apiKey: string): Promise<void> => {
    await createBffClient(API_BASE_URL).setProviderCredential(providerId, apiKey);
  },

  delete: async (providerId: string): Promise<void> => {
    await createBffClient(API_BASE_URL).deleteProviderCredential(providerId);
  },
};
