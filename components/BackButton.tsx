"use client";

import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import { useRouter } from "next/navigation";
import { PropsWithChildren } from "react";
import TransparentButton from "./TransparentButton";
type BackButtonProps = {};

export default function BackButton({}: PropsWithChildren<BackButtonProps>) {
  const router = useRouter();

  return (
    <TransparentButton
      title="back"
      color="black"
      icon={<ArrowBackIosNewIcon />}
      onClick={() => router.back()}
    />
  );
}
