(function () {
    var data = window.__NOTE_INIT__;

    // ── passwdPrompt (used by NeedPasswd page) ──────────────────────
    if (!data && typeof passwdPrompt === "undefined") {
        window.passwdPrompt = function () {
            var passwd = window.prompt(
                (navigator.language || "").startsWith("zh")
                    ? "请输入密码"
                    : "Please enter password."
            );
            if (passwd == null) return;
            if (!passwd.trim()) {
                alert(
                    (navigator.language || "").startsWith("zh")
                        ? "密码不能为空！"
                        : "Password is empty!"
                );
                return;
            }
            var authPath = location.pathname + "/auth";
            fetch(authPath, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ passwd: passwd }),
            })
                .then(function (r) {
                    return r.json();
                })
                .then(function (res) {
                    if (res.err !== 0) {
                        alert("Error: " + res.msg);
                        return;
                    }
                    if (res.data && res.data.refresh) {
                        window.location.reload();
                    }
                })
                .catch(function (err) {
                    alert("Error: " + err);
                });
        };
    }

    if (!data) return;

    var path = data.path;
    var editable = data.editable !== false;

    // ── Save callback (only for editable mode) ──────────────────────
    function handleSave(markdown) {
        return fetch(location.pathname, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ t: markdown }),
        })
            .then(function (r) {
                return r.json();
            })
            .then(function (res) {
                if (res.err !== 0) throw new Error(res.msg);
            });
    }

    // ── Password set callback ───────────────────────────────────────
    var handlePasswordSet;
    if (editable) {
        handlePasswordSet = function (passwd) {
            return fetch(location.pathname + "/pw", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ passwd: passwd }),
            })
                .then(function (r) {
                    return r.json();
                })
                .then(function (res) {
                    if (res.err !== 0) throw new Error(res.msg);
                });
        };
    }

    // ── Share toggle callback ───────────────────────────────────────
    var handleShareToggle;
    if (editable) {
        handleShareToggle = function (enabled) {
            return fetch(location.pathname + "/setting", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ share: enabled }),
            })
                .then(function (r) {
                    return r.json();
                })
                .then(function (res) {
                    if (res.err !== 0) throw new Error(res.msg);
                    return res.data || null;
                });
        };
    }

    // ── Mount the editor ────────────────────────────────────────────
    var root = document.getElementById("editor-root");
    if (root && window.CloudEditor) {
        window.CloudEditor.mount(root, {
            initialContent: data.content,
            path: data.path,
            metadata: data.metadata,
            editable: editable,
            onSave: handleSave,
            onPasswordSet: handlePasswordSet,
            onShareToggle: handleShareToggle,
        });
    }
})();
