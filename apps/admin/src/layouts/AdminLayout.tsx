import { useMemo } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Dropdown, Space, Typography } from "antd";
import {
  ClusterOutlined,
  DeploymentUnitOutlined,
  LogoutOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { ProLayout } from "@ant-design/pro-components";
import { WEB_URL } from "../api";
import { useAuth } from "../auth/AuthContext";

const { Text, Link: ALink } = Typography;

const menuRoutes = {
  path: "/",
  routes: [
    {
      path: "/group/people",
      name: "人员",
      icon: <TeamOutlined />,
      routes: [
        { path: "/users", name: "用户管理" },
        { path: "/members", name: "成员与角色" },
      ],
    },
    {
      path: "/group/bots",
      name: "Bot",
      icon: <DeploymentUnitOutlined />,
      routes: [
        { path: "/bots", name: "Bot 管理" },
        { path: "/onboarding", name: "岗位引导" },
        { path: "/memory", name: "记忆与压缩" },
      ],
    },
    {
      path: "/skills",
      name: "技能",
      icon: <ThunderboltOutlined />,
    },
    {
      path: "/group/models",
      name: "模型",
      icon: <ClusterOutlined />,
      routes: [
        { path: "/llm", name: "默认模型" },
        { path: "/decision", name: "决策模型" },
      ],
    },
    {
      path: "/group/ops",
      name: "运维",
      icon: <SettingOutlined />,
      routes: [
        { path: "/traces", name: "调用追踪" },
        { path: "/usage", name: "用量" },
        { path: "/orgs", name: "组织（平台）" },
        { path: "/flags", name: "功能开关" },
        { path: "/doc-parse", name: "附件解析" },
        { path: "/audit", name: "审计日志" },
      ],
    },
  ],
};

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, orgName, logout } = useAuth();

  const roleLabel = useMemo(() => {
    if (user?.role === "platform_admin") return "平台管理员";
    if (user?.role === "org_admin") return "组织管理员";
    return user?.role || "";
  }, [user?.role]);

  // Highlight「技能」for both /skills and /skills/:name
  const pathname = location.pathname.startsWith("/skills") ? "/skills" : location.pathname;

  return (
    <div style={{ height: "100vh" }}>
      <ProLayout
        title="open-bot 管理端"
        logo={false}
        layout="mix"
        fixSiderbar
        fixedHeader
        location={{ pathname }}
        route={menuRoutes}
        menuItemRender={(item, dom) => {
          const children = item.children || item.routes;
          if (!item.path || (Array.isArray(children) && children.length > 0)) {
            return dom;
          }
          return <Link to={item.path}>{dom}</Link>;
        }}
        avatarProps={{
          icon: <UserOutlined />,
          title: user?.username || "管理员",
          size: "small",
          render: (_props, dom) => (
            <Dropdown
              menu={{
                items: [
                  {
                    key: "logout",
                    icon: <LogoutOutlined />,
                    label: "退出登录",
                    onClick: () => {
                      logout();
                      navigate("/login", { replace: true });
                    },
                  },
                ],
              }}
            >
              {dom}
            </Dropdown>
          ),
        }}
        actionsRender={() => [
          <Space key="org" size={4} style={{ marginRight: 8 }}>
            <Text type="secondary">{orgName || "组织"}</Text>
            <Text type="secondary">·</Text>
            <Text type="secondary">{roleLabel}</Text>
          </Space>,
        ]}
        headerContentRender={() => (
          <ALink href={WEB_URL} style={{ marginLeft: 16, fontSize: 13 }}>
            ← 用户聊天端
          </ALink>
        )}
      >
        <Outlet />
      </ProLayout>
    </div>
  );
}
