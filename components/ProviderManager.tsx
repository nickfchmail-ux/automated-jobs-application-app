"use client";

import { Provider } from "react-redux";

import { store } from "@/state/global/store";
import { PropsWithChildren } from "react";

export default function ProviderManager({ children }: PropsWithChildren) {
  return <Provider store={store}>{children}</Provider>;
}
