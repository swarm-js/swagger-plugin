import { SwaggerPluginOptions } from '../interfaces/SwaggerPluginOptions'

let swarm: any
let conf: SwaggerPluginOptions
let cache: any = {}

export class SwaggerPlugin {
  static setup (instance: any, options: Partial<SwaggerPluginOptions> = {}) {
    swarm = instance

    conf = {
      controllerName: 'SwaggerPlugin',
      access: null,
      ...options
    }

    instance.fastify.register(require('@fastify/static'), {
      root: require('swagger-ui-dist').getAbsoluteFSPath(),
      prefix: '/swagger',
      decorateReply: false
    })

    instance.controllers.addController(conf.controllerName, {
      title: 'Swagger',
      description: 'Handles API documentation display',
      prefix: '/',
      root: true
    })

    instance.controllers.addMethod(
      conf.controllerName,
      SwaggerPlugin.getSwaggerFile,
      {
        method: 'GET',
        route: '/:version/swagger.json',
        title: 'Get Swagger documentation file',
        parameters: [
          {
            name: 'version',
            description: 'The API version, defaults to: v1',
            schema: { type: 'string' }
          }
        ],
        returns: [
          {
            code: 200,
            mimeType: 'application/json',
            description: 'Swagger JSON file',
            schema: { type: 'object', additionalProperties: true }
          }
        ]
      }
    )

    instance.controllers.addMethod(
      conf.controllerName,
      SwaggerPlugin.getSwaggerUi,
      {
        method: 'GET',
        route: '/:version',
        title: 'Get Swagger UI HTML',
        parameters: [
          {
            name: 'version',
            description: 'The API version, defaults to: v1',
            schema: { type: 'string' }
          }
        ],
        returns: [
          {
            code: 200,
            schema: { type: 'string' },
            description: 'Swagger UI HTML code',
            mimeType: 'text/html'
          }
        ]
      }
    )

    instance.controllers.addMethod(
      conf.controllerName,
      SwaggerPlugin.getInitializerFile,
      {
        method: 'GET',
        route: '/:version/swagger-initializer.js',
        title: 'Get Swagger UI initialization file',
        parameters: [
          {
            name: 'version',
            description: 'The API version, defaults to: v1',
            schema: { type: 'string' }
          }
        ],
        returns: [
          {
            code: 200,
            schema: { type: 'string' },
            description: 'Swagger UI initialization script',
            mimeType: 'text/javascript'
          }
        ]
      }
    )
  }

  static schemaNameToSwagger (name: string) {
    return name.replace(/\//g, '_').replace('.json', '')
  }

  static async getSwaggerFile (request: any) {
    swarm.checkAccess(request, conf.access)

    if (cache[request.params.version] === undefined) {
      const ret: any = {
        openapi: '3.0.0',
        info: {
          title: swarm.options.title,
          description: swarm.options.description,
          version: request.params.version
        },
        servers: swarm.options.servers ?? [],
        components: {
          schemas: swarm.schemas.getSwaggerComponents()
        },
        paths: {},
        tags: []
      }

      switch (swarm.options.authType) {
        case 'basic':
          ret.components.securitySchemes = {
            auth: {
              type: 'http',
              scheme: 'basic'
            }
          }
          break
        case 'bearer':
          ret.components.securitySchemes = {
            auth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: swarm.options.bearerFormat
            }
          }
          break
        case 'apiKey':
          ret.components.securitySchemes = {
            auth: {
              type: 'apiKey',
              in: swarm.options.apiKeyLocation,
              name: swarm.options.apiKeyName
            }
          }
          break
        case 'openId':
          ret.components.securitySchemes = {
            auth: {
              type: 'openIdConnect',
              openIdConnectUrl: swarm.options.openIdConnectUrl
            }
          }
          break
        case 'oauth2':
          switch (swarm.options.oauth2Flow) {
            case 'authorizationCode':
              ret.components.securitySchemes = {
                auth: {
                  type: 'oauth2',
                  flows: {
                    authorizationCode: {
                      authorizationUrl: swarm.options.oauth2AuthorizationUrl,
                      tokenUrl: swarm.options.oauth2TokenUrl,
                      refreshUrl: swarm.options.oauth2RefreshUrl,
                      scopes: swarm.options.oauth2Scopes
                    }
                  }
                }
              }
              break
            case 'implicit':
              ret.components.securitySchemes = {
                auth: {
                  type: 'oauth2',
                  flows: {
                    implicit: {
                      authorizationUrl: swarm.options.oauth2AuthorizationUrl,
                      refreshUrl: swarm.options.oauth2RefreshUrl,
                      scopes: swarm.options.oauth2Scopes
                    }
                  }
                }
              }
              break
            case 'password':
              ret.components.securitySchemes = {
                auth: {
                  type: 'oauth2',
                  flows: {
                    password: {
                      tokenUrl: swarm.options.oauth2TokenUrl,
                      refreshUrl: swarm.options.oauth2RefreshUrl,
                      scopes: swarm.options.oauth2Scopes
                    }
                  }
                }
              }
              break
            case 'clientCredentials':
              ret.components.securitySchemes = {
                auth: {
                  type: 'oauth2',
                  flows: {
                    clientCredentials: {
                      tokenUrl: swarm.options.oauth2TokenUrl,
                      refreshUrl: swarm.options.oauth2RefreshUrl,
                      scopes: swarm.options.oauth2Scopes
                    }
                  }
                }
              }
              break
          }
          break
      }

      for (let controller of swarm.controllers.list) {
        ret.tags.push({
          name: controller.title ?? controller.name,
          description: controller.description
        })

        if (controller.access !== null) {
          for (let item of controller.access) {
            if (
              ret.components?.securitySchemes?.auth?.flows?.scopes !==
                undefined &&
              ret.components.securitySchemes.auth.flows.scopes[item] ===
                undefined
            )
              ret.components.securitySchemes.auth.flows.scopes[item] = item
          }
        }

        for (let method of controller.methods) {
          if (
            method.version.includes(request.params.version) === false &&
            !controller.root
          )
            continue
          const path = `${controller.root ? '' : '/' + request.params.version}${
            method.fullRoute
          }`
            .split('/')
            .map(p => (p.substring(0, 1) === ':' ? `{${p.substring(1)}}` : p))
            .join('/')
          const verb = (method.method as string).toLowerCase()

          if (ret.paths[path] === undefined) ret.paths[path] = {}

          if (method.access !== null) {
            for (let item of method.access) {
              if (
                ret.components?.securitySchemes?.auth?.flows?.scopes !==
                  undefined &&
                ret.components.securitySchemes.auth.flows.scopes[item] ===
                  undefined
              )
                ret.components.securitySchemes.auth.flows.scopes[item] = item
            }
          }

          ret.paths[path][verb] = {
            tags: [controller.title ?? controller.name],
            summary: method.title,
            description: method.description,
            operationId: `${controller.name}@${method.name}`,
            security:
              controller.access !== null || method.access !== null
                ? [
                    {
                      auth:
                        method.access !== null
                          ? method.access
                          : controller.access
                    }
                  ]
                : undefined,
            parameters: [
              ...controller.parameters.map((param: any) => ({
                name: param.name,
                in: 'path',
                schema: !param.schema
                  ? undefined
                  : typeof param.schema === 'string'
                  ? {
                      $ref: `#/components/schemas/${SwaggerPlugin.schemaNameToSwagger(
                        param.schema
                      )}`
                    }
                  : param.schema,
                required: true
              })),
              ...method.parameters.map((param: any) => ({
                name: param.name,
                in: 'path',
                schema: !param.schema
                  ? undefined
                  : typeof param.schema === 'string'
                  ? {
                      $ref: `#/components/schemas/${SwaggerPlugin.schemaNameToSwagger(
                        param.schema
                      )}`
                    }
                  : param.schema,
                required: true
              })),
              ...method.query.map((param: any) => ({
                name: param.name,
                in: 'query',
                schema: !param.schema
                  ? undefined
                  : typeof param.schema === 'string'
                  ? {
                      $ref: `#/components/schemas/${SwaggerPlugin.schemaNameToSwagger(
                        param.schema
                      )}`
                    }
                  : param.schema,
                required: false
              }))
            ],
            requestBody:
              ['post', 'put', 'patch'].includes(verb) && method.accepts
                ? {
                    required: true,
                    content: {
                      [method.accepts.mimeType]: {
                        schema: !method.accepts.schema
                          ? undefined
                          : typeof method.accepts.schema === 'string'
                          ? {
                              $ref: `#/components/schemas/${SwaggerPlugin.schemaNameToSwagger(
                                method.accepts.schema
                              )}`
                            }
                          : method.accepts.schema
                      }
                    }
                  }
                : undefined,
            responses: Object.fromEntries(
              method.returns
                .map((r: any): any => {
                  return [
                    r.code,
                    {
                      description: r.description,
                      content: {
                        [r.mimeType]: {
                          schema: !r.schema
                            ? undefined
                            : typeof r.schema === 'string'
                            ? {
                                $ref: `#/components/schemas/${SwaggerPlugin.schemaNameToSwagger(
                                  r.schema
                                )}`
                              }
                            : r.schema
                        }
                      }
                    }
                  ]
                })
                .filter((r: any) => r !== null)
            )
          }
        }
      }

      cache[request.params.version] = ret
    }

    return cache[request.params.version]
  }

  static async getSwaggerUi (request: any, reply: any) {
    swarm.checkAccess(request, conf.access)

    reply.type('text/html').send(`<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Swagger UI</title>
        <link rel="stylesheet" type="text/css" href="/swagger/swagger-ui.css" />
        <link rel="stylesheet" type="text/css" href="/swagger/index.css" />
        <link rel="icon" type="image/png" href="/swagger/favicon-32x32.png" sizes="32x32" />
        <link rel="icon" type="image/png" href="/swagger/favicon-16x16.png" sizes="16x16" />
        <script src="https://unpkg.com/react@15/dist/react.min.js"></script>
      </head>
    
      <body>
        <div id="swagger-ui"></div>
        <script src="/swagger/swagger-ui-bundle.js" charset="UTF-8"> </script>
        <script src="/swagger/swagger-ui-standalone-preset.js" charset="UTF-8"> </script>
        <script src="/${request.params.version}/swagger-initializer.js" charset="UTF-8"> </script>
      </body>
    </html>
    `)
  }

  static async getInitializerFile (request: any, reply: any) {
    swarm.checkAccess(request, conf.access)

    reply.type('text/javascript').send(`window.onload = function() {
      const h = React.createElement

  window.ui = SwaggerUIBundle({
    url: "/${request.params.version}/swagger.json",
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [
      SwaggerUIBundle.presets.apis,
      SwaggerUIStandalonePreset,
      system => {
        // Variable to capture the security prop of OperationSummary
        // then pass it to authorizeOperationBtn
        let currentSecurity
        return {
            wrapComponents: {
                // Wrap OperationSummary component to get its prop
                OperationSummary: Original => props => {
                    const security = props.operationProps.get('security')
                    currentSecurity = security.toJS()
                    return h(Original, props)
                },
                // Wrap the padlock button to show the
                // scopes required for current operation
                authorizeOperationBtn: Original =>
                    function (props) {
                        return h('div', {}, [
                            ...(currentSecurity || []).map(scheme => {
                                const schemeName = Object.keys(scheme)[0]
                                if (!scheme[schemeName].length) return null

                                const scopes = scheme[schemeName].flatMap(scope => [
                                    h('code', null, scope),
                                    ', ',
                                ])
                                scopes.pop()
                                return h('span', null, [schemeName, '(', ...scopes, ')'])
                            }),
                            h(Original, props),
                        ])
                    },
            },
        }
    },
    ],
    plugins: [
      SwaggerUIBundle.plugins.DownloadUrl
    ],
    layout: "StandaloneLayout"
  });
};
`)
  }
}
