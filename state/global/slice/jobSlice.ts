import { job } from "@/types/job";
import { createSlice } from "@reduxjs/toolkit";
interface JobsState {
  jobs: job[];
}

const initialState: JobsState = { jobs: [] };

const jobSlice = createSlice({
  name: "job",
  initialState,
  reducers: {
    loadJobs: (state, action) => {
      state.jobs = action.payload;
    },
  },
});

export const { loadJobs } = jobSlice.actions;

export default jobSlice.reducer;
