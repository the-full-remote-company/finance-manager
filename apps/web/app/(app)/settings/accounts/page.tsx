"use client";

import { Modal, Table, type TableColumn } from "@finance/ui";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { useRequireSession } from "../../../../lib/use-require-session.js";
import { toAppClientError, trpc } from "../../../../lib/trpc/browser.js";

interface AccountRow {
  id: string;
  name: string;
  note: string | null;
  sortOrder: number;
}

/**
 * T084: the settings screen for accounts. FR-007, FR-009, FR-009a.
 */
export default function AccountsSettingsPage() {
  const ready = useRequireSession();
  const t = useTranslations("settings.accounts");
  const tCommon = useTranslations("common");

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const nameId = useId();
  const noteId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [renameTarget, setRenameTarget] = useState<AccountRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameTitleId = useId();

  const [stillReferenced, setStillReferenced] = useState<{
    account: AccountRow;
    count: number;
  } | null>(null);
  const stillReferencedTitleId = useId();

  async function reload() {
    const list = await trpc.accounts.list.query({});
    setAccounts(list);
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
      await trpc.accounts.create.mutate({ name, note: note.trim().length > 0 ? note : undefined });
      setName("");
      setNote("");
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
    await trpc.accounts.rename.mutate({ id: renameTarget.id, name: renameValue });
    setRenameTarget(null);
    await reload();
  }

  async function handleDelete(account: AccountRow) {
    try {
      await trpc.accounts.delete.mutate({ id: account.id });
      await reload();
    } catch (error) {
      const appError = toAppClientError(error);
      if (appError?.appCode === "STILL_REFERENCED") {
        const count = Number(appError.details?.["referenceCount"] ?? 0);
        setStillReferenced({ account, count });
      }
    }
  }

  const columns: TableColumn<AccountRow>[] = [
    { key: "name", header: t("columnName"), render: (row) => row.name },
    { key: "note", header: t("columnNote"), render: (row) => row.note ?? "" },
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
          rows={accounts}
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
        <div className="field">
          <label htmlFor={noteId}>{t("noteLabel")}</label>
          <input
            id={noteId}
            type="text"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </div>
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
          <label htmlFor="rename-account-name">{t("nameLabel")}</label>
          <input
            id="rename-account-name"
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
              setRenameTarget(stillReferenced.account);
              setRenameValue(stillReferenced.account.name);
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
