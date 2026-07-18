import type { ExtensionMessage, ExtensionResponse } from './types';

export async function sendExtensionMessage<T>(
  message: ExtensionMessage,
): Promise<ExtensionResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<ExtensionResponse<T>>;
}
