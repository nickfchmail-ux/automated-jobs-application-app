"use client";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useRouter } from "next/navigation";
import TransparentButton from "./TransparentButton";

export default function BackButton() {
  const router = useRouter();

  return (
    <TransparentButton
      title="Back"
      color="black"
      icon={<ArrowBackIcon fontSize="small" />}
      noBorder={true}
      onClick={() => router.back()}
    />
  );
}
