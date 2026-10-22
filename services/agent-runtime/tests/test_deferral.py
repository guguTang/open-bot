from app.deferral import (
    CONTINUE_HOST_DELETE,
    CONTINUE_HOST_LIST,
    host_followup_prompt,
    host_list_hint,
    turn_unfinished,
)


def test_chat_without_a_file_is_finished():
    messages = [
        {"role": "user", "content": "你好"},
        {"role": "assistant", "content": "我来把这一版补上战斗动画，做好后给你。"},
    ]
    assert turn_unfinished([], messages) is False


def test_older_file_does_not_reopen_the_turn():
    messages = [
        {"role": "assistant", "content": "打开 [文件](sandbox:/workspace/bots/x/web_rpg.html)"},
        {"role": "user", "content": "做完了么"},
        {
            "role": "assistant",
            "content": "还没完全做完，确认后我再把更新版发给你。",
        },
    ]
    assert turn_unfinished([], messages) is False


def test_this_turn_file_link_without_a_tool_is_still_running():
    messages = [
        {"role": "user", "content": "把这一版页面交出来"},
        {"role": "assistant", "content": "打开 [文件](sandbox:/workspace/bots/x/web_rpg.html)"},
    ]
    assert turn_unfinished([], messages) is True


def test_delivery_tool_finishes_the_turn():
    messages = [
        {"role": "assistant", "content": "sandbox:/workspace/bots/x/web_rpg.html"},
    ]
    assert turn_unfinished(["sandbox_write"], messages) is False


def test_colleague_link_does_not_keep_the_turn_open():
    messages = [
        {"role": "user", "content": "总结下这个文档"},
        {
            "role": "user",
            "content": "【代码】已整理成可浏览的摘要页面：[打开文档摘要](sandbox:/workspace/shared/pdf-summary.html)",
        },
        {"role": "assistant", "content": "这份编制说明主要论证了总体架构。"},
        {
            "role": "user",
            "content": "总结下这个文档\n\n（用户上传了 1 个附件）\n- scan.pdf\n  （PDF 未提取到正文；若是扫描件，当前不支持 OCR）",
        },
        {"role": "assistant", "content": "目前没有提取到这份 PDF 的正文，所以我还无法可靠总结。"},
    ]
    assert turn_unfinished([], messages) is False


def test_later_question_does_not_reopen_a_delivered_file():
    messages = [
        {"role": "assistant", "content": "打开 [摘要](sandbox:/workspace/shared/pdf-summary.html)"},
        {"role": "user", "content": "任职过哪几家公司"},
        {"role": "assistant", "content": "北京格灵深瞳、北京灵汐、北京数码大方。"},
    ]
    assert turn_unfinished([], messages) is False


def test_onboarding_without_a_file_is_finished():
    messages = [
        {"role": "user", "content": "先用你来写代码"},
        {"role": "assistant", "content": "好的，我会优先帮你写代码和排障。"},
    ]
    assert turn_unfinished([], messages) is False


def test_host_delete_intent_forces_tool():
    messages = [
        {"role": "user", "content": "这两个mp4删了"},
        {"role": "assistant", "content": "已发起删除，请在电脑上确认。"},
    ]
    assert host_followup_prompt([], messages) == CONTINUE_HOST_DELETE
    assert host_followup_prompt(["host_delete"], messages) is None


def test_host_retry_after_denied_forces_delete():
    messages = [
        {
            "role": "assistant",
            "content": "这两次删除请求被拒绝了。需要我再试一次吗？",
        },
        {"role": "user", "content": "再试一次"},
    ]
    assert host_followup_prompt(["host_ls"], messages) == CONTINUE_HOST_DELETE



def test_retry_after_screenshot_permission_does_not_force_delete():
    """「再试试」+ 上句含「允许」(屏幕录制权限) 不得误触发删文件 nudge。"""
    messages = [
        {
            "role": "assistant",
            "content": "目前没能截图：Mac 尚未允许 Open Bot 进行屏幕录制。请到「系统设置 → 隐私与安全性 → 屏幕录制」中允许 Open Bot，然后告诉我，我再帮你截。",
        },
        {"role": "user", "content": "再试试"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "x"}]},
        {
            "role": "tool",
            "tool_call_id": "x",
            "name": "host_screenshot",
            "content": '{"ok": false, "error": "没有屏幕录制权限。请允许 Open Bot"}',
        },
    ]
    assert host_followup_prompt(["host_screenshot"], messages) is None
    assert host_followup_prompt([], messages) is None



def test_retry_after_non_delete_denial_does_not_force_delete():
    """「再试」+ 上句仅有「拒绝」(发信/执行确认被拒) 不得误触发删文件 nudge。"""
    messages = [
        {
            "role": "assistant",
            "content": "发信请求被拒绝了。需要我再试一次吗？",
        },
        {"role": "user", "content": "再试一次"},
    ]
    assert host_followup_prompt([], messages) is None

    messages = [
        {
            "role": "assistant",
            "content": "这次本机命令被拒绝了，没有执行。",
        },
        {"role": "user", "content": "再试试"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "x"}]},
        {
            "role": "tool",
            "tool_call_id": "x",
            "name": "host_shell",
            "content": '{"ok": false, "denied": true, "error": "用户拒绝了这次操作"}',
        },
    ]
    assert host_followup_prompt(["host_shell"], messages) is None


def test_retry_after_vague_denied_without_delete_words_does_not_force_delete():
    """仅有「被拒绝了」而无删除语境时，宁可不强制删（避免误删）。"""
    messages = [
        {"role": "assistant", "content": "被拒绝了"},
        {"role": "user", "content": "再试一次"},
    ]
    assert host_followup_prompt([], messages) is None


def test_host_list_hint_uses_the_users_own_sentence():
    assert host_list_hint("看看下载文件夹最大的文件排前三的") == CONTINUE_HOST_LIST
    brief = (
        "会话上下文：\n"
        "同事代码：已经做好。[下载俄罗斯方块页面](sandbox:/workspace/bots/a/tetris.html)\n\n"
        "请处理用户刚说的：游戏区域的当前方块不显示"
    )
    assert host_list_hint(brief) is None
    messages = [{"role": "user", "content": brief}]
    assert host_followup_prompt(["sandbox_shell"], messages) is None
    assert host_followup_prompt([], messages) is None

def test_colleague_note_about_delete_card_does_not_force_host_delete():
    """Handoff notes like 【333】…无法弹出删除确认卡 must not become delete intent."""
    messages = [
        {"role": "user", "content": "优锘科技是做什么的"},
        {"role": "assistant", "content": "优锘科技主要做数字孪生与可视化运维相关产品。"},
        {
            "role": "user",
            "content": "【333】我这边无法弹出删除确认卡，你那边再看下宿主删除链路。",
        },
    ]
    assert host_followup_prompt([], messages) is None
    assert host_followup_prompt(["host_ls"], messages) is None


def test_real_user_delete_and_retry_still_nudge():
    messages = [
        {"role": "user", "content": "删了这些文件"},
        {"role": "assistant", "content": "已发起删除，请在电脑上确认。"},
    ]
    assert host_followup_prompt([], messages) == CONTINUE_HOST_DELETE

    messages = [
        {
            "role": "assistant",
            "content": "这两次删除请求被拒绝了。需要我再试一次吗？",
        },
        {"role": "user", "content": "再试一次"},
    ]
    assert host_followup_prompt([], messages) == CONTINUE_HOST_DELETE


def test_handoff_embedding_own_ask_delete_still_nudges():
    messages = [
        {
            "role": "user",
            "content": "【333】用户要删本机文件。请处理用户刚说的：删掉这两个 mp4",
        },
    ]
    assert host_followup_prompt([], messages) == CONTINUE_HOST_DELETE
    assert host_followup_prompt(["host_delete"], messages) is None

