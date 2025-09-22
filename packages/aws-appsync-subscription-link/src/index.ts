// Import the subscription handshake link implementation and control event constant
import {
  SubscriptionHandshakeLink,
  CONTROL_EVENTS_KEY
} from "./subscription-handshake-link";

// Apollo Client core utilities for building link chains and observables
import { ApolloLink, Observable } from "@apollo/client/core";
import { createHttpLink } from "@apollo/client/link/http";
import { getMainDefinition } from "@apollo/client/utilities";

// Helper link that forwards operations without terminating the chain
import { NonTerminatingLink } from "./non-terminating-link";

// Types from GraphQL schema AST
import type { OperationDefinitionNode } from "graphql";

// Real-time subscription handshake link for AppSync
import {
  AppSyncRealTimeSubscriptionHandshakeLink,
} from "./realtime-subscription-handshake-link";

// Configuration type for AppSync subscription
import { AppSyncRealTimeSubscriptionConfig } from "./types";

/**
 * createSubscriptionHandshakeLink
 *
 * Factory function that builds an Apollo Link to handle GraphQL subscriptions
 * with AWS AppSync. It sets up the subscription handshake process for both
 * regular HTTP endpoints and AppSync real-time endpoints.
 *
 * @param infoOrUrl - Either a full configuration object or just a URL string
 * @param theResultsFetcherLink - Optional ApolloLink for fetching results
 * @returns ApolloLink - A split link that routes queries/mutations to HTTP
 *                       and subscriptions to WebSocket/AppSync
 */
function createSubscriptionHandshakeLink(
  args: AppSyncRealTimeSubscriptionConfig,
  resultsFetcherLink?: ApolloLink
): ApolloLink;
function createSubscriptionHandshakeLink(
  url: string,
  resultsFetcherLink?: ApolloLink
): ApolloLink;
function createSubscriptionHandshakeLink(
  infoOrUrl: AppSyncRealTimeSubscriptionConfig | string,
  theResultsFetcherLink?: ApolloLink
) {
  let resultsFetcherLink: ApolloLink, subscriptionLinks: ApolloLink;

  // Case 1: If `infoOrUrl` is a plain URL string
  if (typeof infoOrUrl === "string") {
    // Use provided resultsFetcherLink or create an HTTP link
    resultsFetcherLink =
      theResultsFetcherLink || createHttpLink({ uri: infoOrUrl });

    // Build a link chain for subscriptions
    subscriptionLinks = ApolloLink.from([
      // NonTerminatingLink to handle control messages
      new NonTerminatingLink("controlMessages", {
        link: new ApolloLink(
          (operation, _forward) =>
            new Observable<any>(observer => {
              // Extract control events from operation variables
              const {
                variables: { [CONTROL_EVENTS_KEY]: controlEvents, ...variables }
              } = operation;

              // If control events exist, strip them from the variables
              if (typeof controlEvents !== "undefined") {
                operation.variables = variables;
              }

              // Emit the control events back to observer
              observer.next({ [CONTROL_EVENTS_KEY]: controlEvents });

              // Cleanup function when subscription ends
              return () => { };
            })
        )
      }),

      // NonTerminatingLink to attach subscription info and forward results
      new NonTerminatingLink("subsInfo", { link: resultsFetcherLink }),

      // Subscription handshake link to manage the protocol handshake
      new SubscriptionHandshakeLink("subsInfo")
    ]);
  } else {
    // Case 2: If `infoOrUrl` is a configuration object
    const { url } = infoOrUrl;

    // Use provided resultsFetcherLink or create an HTTP link
    resultsFetcherLink = theResultsFetcherLink || createHttpLink({ uri: url });

    // Use the AppSync real-time handshake implementation
    subscriptionLinks = new AppSyncRealTimeSubscriptionHandshakeLink(infoOrUrl);
  }

  // Return a split Apollo Link:
  // - Subscriptions → handled by subscriptionLinks
  // - Queries/Mutations → handled by resultsFetcherLink
  return ApolloLink.split(
    operation => {
      const { query } = operation;

      // Extract operation definition from GraphQL query
      const { kind, operation: graphqlOperation } = getMainDefinition(
        query
      ) as OperationDefinitionNode;

      // Check if the operation is a subscription
      const isSubscription =
        kind === "OperationDefinition" && graphqlOperation === "subscription";

      return isSubscription;
    },
    subscriptionLinks,  // For subscriptions
    resultsFetcherLink  // For queries and mutations
  );
}

// Export the control event constant and link factory function
export { CONTROL_EVENTS_KEY, createSubscriptionHandshakeLink };
