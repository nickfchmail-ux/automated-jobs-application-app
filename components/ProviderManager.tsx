"use client";

import { Provider } from "react-redux";

import { store } from "@/state/global/store";
import { PropsWithChildren } from "react";
import { ToastProvider } from "./Toast";

export default function ProviderManager({ children }: PropsWithChildren) {
  return (
    <Provider store={store}>
      <ToastProvider>{children}</ToastProvider>
    </Provider>
  );
}
