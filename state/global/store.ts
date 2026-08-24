import { configureStore } from "@reduxjs/toolkit";
import jobReducer from "./slice/jobSlice";
import runReducer from "./slice/runSlice";

export const store = configureStore({
  reducer: {
    jobs: jobReducer,
    run: runReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;

export type AppDispatch = typeof store.dispatch;
