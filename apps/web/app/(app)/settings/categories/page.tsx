"use client";

import { Modal, Select, Table, type TableColumn } from "@finance/ui";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { toAppClientError, trpc } from "../../../../lib/trpc/browser.js";
import { useRequireSession } from "../../../../lib/use-require-session.js";

interface CategoryRow {
  id: string;
  name: string;
  direction: "income" | "expense";
  sortOrder: number;
}

/**
 * T084: the settings screen for categories. FR-008, FR-009, FR-009a.
 * Direction is immutable after creation (contracts/procedures.md), so it is
 * shown but not editable once a category exists.
 */
export default function CategoriesSettingsPage() {
  const ready = useRequireSession();
  const t = useTranslations("settings.categories");
  const tCommon = useTranslations("common");

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [name, setName] = useState("");
  const [direction, setDirection] = useState<"income" | "expense">("expense");
  const nameId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [renameTarget, setRenameTarget] = useState<CategoryRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameTitleId = useId();

  const [stillReferenced, setStillReferenced] = useState<{
    category: CategoryRow;
    count: number;
  } | null>(null);
  const stillReferencedTitleId = useId();

  async function reload() {
    const list = await trpc.categories.list.query({});
    setCategories(list);
    setLoaded(true);
  }

  useEffect(() => {
    if (ready) void reload();
  }, [ready]);

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);
    setSubmitting(true);
    try {
      await trpc.categories.create.mutate({ name, direction });
      setName("");
      await reload();
    } catch (error) {
      const appError = toAppClientError(error);
      setCreateError(appError?.appCode === "NAME_TAKEN" ? t("nameTaken") : t("genericError"));
      nameRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRename() {
    if (!renameTarget) return;
    await trpc.categories.rename.mutate({ id: renameTarget.id, name: renameValue });
    setRenameTarget(null);
    await reload();
  }

  async function handleDelete(category: CategoryRow) {
    try {
      await trpc.categories.delete.mutate({ id: category.id });
      await reload();
    } catch (error) {
      const appError = toAppClientError(error);
      if (appError?.appCode === "STILL_REFERENCED") {
        const count = Number(appError.details?.["referenceCount"] ?? 0);
        setStillReferenced({ category, count });
      }
    }
  }

  const columns: TableColumn<CategoryRow>[] = [
    { key: "name", header: t("columnName"), render: (row) => row.name },
    {
      key: "direction",
      header: t("columnDirection"),
      render: (row) => (row.direction === "income" ? t("directionIncome") : t("directionExpense")),
    },
    {
      key: "actions",
      header: t("columnActions"),
      render: (row) => (
        <>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setRenameTarget(row);
              setRenameValue(row.name);
            }}
          >
            {t("renameSubmit")}
          </button>{" "}
          <button type="button" className="btn btn--ghost" onClick={() => void handleDelete(row)}>
            {t("deleteAction")}
          </button>
        </>
      ),
    },
  ];

  if (!ready) return null;

  return (
    <section>
      <h1>{t("title")}</h1>

      {loaded && (
        <Table
          columns={columns}
          rows={categories}
          getRowKey={(row) => row.id}
          caption={t("title")}
          emptyMessage={t("empty")}
        />
      )}

      <form onSubmit={(event) => void handleCreate(event)} noValidate>
        <div className="field">
          <label htmlFor={nameId}>{t("nameLabel")}</label>
          <input
            id={nameId}
            ref={nameRef}
            type="text"
            required
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
        <Select
          id="category-direction"
          label={t("directionLabel")}
          value={direction}
          onChange={(value) => {
            setDirection(value === "income" ? "income" : "expense");
          }}
          options={[
            { value: "expense", label: t("directionExpense") },
            { value: "income", label: t("directionIncome") },
          ]}
        />
        {createError !== null && <p role="alert">{createError}</p>}
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {t("createSubmit")}
        </button>
      </form>

      <Modal
        open={renameTarget !== null}
        onClose={() => {
          setRenameTarget(null);
        }}
        titleId={renameTitleId}
        title={t("renameSubmit")}
        closeLabel={t("closeLabel")}
      >
        <div className="field">
          <label htmlFor="rename-category-name">{t("nameLabel")}</label>
          <input
            id="rename-category-name"
            type="text"
            value={renameValue}
            onChange={(event) => {
              setRenameValue(event.target.value);
            }}
          />
        </div>
        <button type="button" className="btn btn--primary" onClick={() => void submitRename()}>
          {tCommon("save")}
        </button>
      </Modal>

      <Modal
        open={stillReferenced !== null}
        onClose={() => {
          setStillReferenced(null);
        }}
        titleId={stillReferencedTitleId}
        title={t("stillReferencedTitle")}
        closeLabel={t("closeLabel")}
      >
        {stillReferenced !== null && (
          <p>{t("stillReferencedBody", { count: stillReferenced.count })}</p>
        )}
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            if (stillReferenced) {
              setRenameTarget(stillReferenced.category);
              setRenameValue(stillReferenced.category.name);
            }
            setStillReferenced(null);
          }}
        >
          {t("renameSubmit")}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setStillReferenced(null);
          }}
        >
          {tCommon("cancel")}
        </button>
      </Modal>
    </section>
  );
}
