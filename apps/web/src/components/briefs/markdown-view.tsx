"use client";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  markdown: string;
  className?: string;
};

export default function MarkdownView({ markdown, className }: Props) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ ...props }) => (
            <h1 className="text-2xl font-semibold mb-2" {...props} />
          ),
          h2: ({ ...props }) => (
            <h2 className="text-xl font-semibold mt-4 mb-2" {...props} />
          ),
          h3: ({ ...props }) => (
            <h3 className="text-lg font-medium mt-3 mb-1" {...props} />
          ),
          ul: ({ ...props }) => (
            <ul className="list-disc pl-5 space-y-1" {...props} />
          ),
          ol: ({ ...props }) => (
            <ol className="list-decimal pl-5 space-y-1" {...props} />
          ),
          p: ({ ...props }) => (
            <p className="mb-2 leading-relaxed" {...props} />
          ),
          a: ({ ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            />
          ),
          code: ({ className, children, ...props }) => (
            <code
              className={
                "rounded bg-border/40 px-1 py-0.5 text-[0.9em] " +
                (className || "")
              }
              {...props}
            >
              {children}
            </code>
          ),
          table: ({ ...props }) => (
            <table className="w-full text-sm border-collapse" {...props} />
          ),
          th: ({ ...props }) => (
            <th className="border-b px-2 py-1 text-left" {...props} />
          ),
          td: ({ ...props }) => (
            <td className="border-b px-2 py-1 align-top" {...props} />
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
