import { normalize } from 'pathe'
import { defu } from 'defu'
import type { Nuxt } from '@nuxt/schema'
import type { NitroConfig } from 'nitropack'
import { createResolver, resolvePath } from '@nuxt/kit'
import { hash } from 'ohash'
import { provider, type ProviderName } from 'std-env'
import type { InputProvider, ImageModuleProvider, ProviderSetup } from './types'
import type { ModuleOptions } from './module'
import { ipxSetup } from './ipx'

// Please add new providers alphabetically to the list below
const BuiltInProviders = [
  'aliyun',
  'awsAmplify',
  'bunny',
  'caisy',
  'cloudflare',
  'cloudimage',
  'cloudinary',
  'contentful',
  'directus',
  'edgio',
  'fastly',
  'glide',
  'gumlet',
  'hygraph',
  'imageengine',
  'imagekit',
  'imgix',
  'ipx',
  'ipxStatic',
  'layer0',
  'netlify',
  'netlifyLargeMedia',
  'netlifyImageCdn',
  'prepr',
  'none',
  'prismic',
  'sanity',
  'storyblok',
  'strapi',
  'twicpics',
  'unsplash',
  'uploadcare',
  'vercel',
  'wagtail',
  'weserv',
  'sirv',
] as const

export type ImageProviderName = typeof BuiltInProviders[number]

export const providerSetup: Partial<Record<ImageProviderName, ProviderSetup>> = {
  // IPX
  ipx: ipxSetup(),
  ipxStatic: ipxSetup({ isStatic: true }),

  // https://vercel.com/docs/more/adding-your-framework#images
  vercel(_providerOptions, moduleOptions, nuxt: Nuxt) {
    nuxt.options.nitro = defu(nuxt.options.nitro, {
      vercel: {
        config: {
          images: {
            domains: moduleOptions.domains,
            minimumCacheTTL: 60 * 5,
            sizes: Array.from(new Set(Object.values(moduleOptions.screens || {}))),
          },
        },
      } satisfies NitroConfig['vercel'],
    })
  },

  awsAmplify(_providerOptions, moduleOptions, nuxt: Nuxt) {
    nuxt.options.nitro = defu(nuxt.options.nitro, {
      awsAmplify: {
        imageOptimization: {
          path: '/_amplify/image',
          cacheControl: 'public, max-age=300, immutable',
        },
        imageSettings: {
          sizes: Array.from(new Set(Object.values(moduleOptions.screens || {}))),
          formats: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] satisfies NonNullable<NonNullable<NitroConfig['awsAmplify']>['imageSettings']>['formats'],
          minimumCacheTTL: 60 * 5,
          domains: moduleOptions.domains,
          remotePatterns: [], // Provided by domains
          dangerouslyAllowSVG: false, // TODO
        },
      },
    })
  },
  // https://docs.netlify.com/image-cdn/create-integration/
  netlify(_providerOptions, moduleOptions, nuxt: Nuxt) {
    if (moduleOptions.domains?.length > 0) {
      nuxt.options.nitro = defu(nuxt.options.nitro, {
        netlify: {
          images: {
            remote_images: moduleOptions.domains.map(domain => `https?:\\/\\/${domain.replaceAll('.', '\\.')}\\/.*`),
          },
        },
      })
    }
  },
}

export async function resolveProviders(nuxt: any, options: ModuleOptions): Promise<ImageModuleProvider[]> {
  const providers: ImageModuleProvider[] = []

  for (const key in options) {
    if (BuiltInProviders.includes(key as ImageProviderName)) {
      providers.push(await resolveProvider(nuxt, key, { provider: key, options: options[key] }))
    }
  }

  for (const key in options.providers) {
    providers.push(await resolveProvider(nuxt, key, options.providers[key]))
  }

  return providers
}

export async function resolveProvider(_nuxt: any, key: string, input: InputProvider): Promise<ImageModuleProvider> {
  if (typeof input === 'string') {
    input = { name: input }
  }

  if (!input.name) {
    input.name = key
  }

  if (!input.provider) {
    input.provider = input.name
  }

  if (input.provider in normalizableProviders) {
    input.provider = normalizableProviders[input.provider]!()
  }

  const resolver = createResolver(import.meta.url)
  
  const setup = input.setup || providerSetup[input.provider as ImageProviderName] || providerSetup[input.name as ImageProviderName]

  input.provider = BuiltInProviders.includes(input.provider as ImageProviderName)
    ? await resolver.resolve('./runtime/providers/' + input.provider)
    : await resolvePath(input.provider)

  return <ImageModuleProvider> {
    ...input,
    setup,
    runtime: normalize(input.provider!),
    importName: `${key}Runtime$${hash(input.provider)}`,
    runtimeOptions: input.options,
  }
}

const autodetectableProviders: Partial<Record<ProviderName, ImageProviderName>> = {
  vercel: 'vercel',
  aws_amplify: 'awsAmplify',
  netlify: 'netlify',
}

const normalizableProviders: Partial<Record<string, () => ImageProviderName>> = {
  netlify: () => {
    return process.env.NETLIFY_LFS_ORIGIN_URL ? 'netlifyLargeMedia' : 'netlifyImageCdn'
  },
}

export function detectProvider(userInput: string = '') {
  if (process.env.NUXT_IMAGE_PROVIDER) {
    return process.env.NUXT_IMAGE_PROVIDER
  }

  if (userInput && userInput !== 'auto') {
    return userInput
  }

  if (provider in autodetectableProviders) {
    return autodetectableProviders[provider]
  }
}
