import axios from 'axios'
import { useAuthStore } from '@/stores/authStore'

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Auto-logout on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ─── VM API ───────────────────────────────────────────────────────────────────
export const vmApi = {
  list:            () => api.get('/vms').then((r) => r.data),
  detail:          (hid: string, name: string) => api.get(`/vms/${hid}/${name}`).then((r) => r.data),
  action:          (hid: string, name: string, action: string) =>
                     api.post(`/vms/${hid}/${name}/action`, { action }).then((r) => r.data),
  create:          (body: object) => api.post('/vms', body).then((r) => r.data),
  delete:          (hid: string, name: string) => api.delete(`/vms/${hid}/${name}`).then((r) => r.data),
  checkpoints:     (hid: string, name: string) => api.get(`/vms/${hid}/${name}/checkpoints`).then((r) => r.data),
  createCheckpoint:(hid: string, name: string, snapName: string) =>
                     api.post(`/vms/${hid}/${name}/checkpoints`, { name: snapName }).then((r) => r.data),
  deleteCheckpoint:(hid: string, name: string, snapId: string) =>
                     api.delete(`/vms/${hid}/${name}/checkpoints/${snapId}`).then((r) => r.data),
  revertCheckpoint:(hid: string, name: string, snapId: string) =>
                     api.post(`/vms/${hid}/${name}/checkpoints/${snapId}/revert`).then((r) => r.data),
  ejectCD:         (hid: string, name: string) =>
                     api.post(`/servers/${hid}/vms/${name}/eject-cd`).then((r) => r.data),
  consoleToken:    (hid: string, name: string) =>
                     api.post(`/servers/${hid}/vms/${name}/console-token`).then((r) => r.data),
}

// ─── Folder API ───────────────────────────────────────────────────────────────
export const folderApi = {
  list:       () => api.get('/folders').then((r) => r.data),
  get:        (id: string) => api.get(`/folders/${id}`).then((r) => r.data),
  create:     (body: object) => api.post('/folders', body).then((r) => r.data),
  update:     (id: string, body: object) => api.patch(`/folders/${id}`, body).then((r) => r.data),
  delete:     (id: string) => api.delete(`/folders/${id}`).then((r) => r.data),
  hypervisors:() => api.get('/folders/hypervisors/all').then((r) => r.data),
  addHypervisor:  (body: object) => api.post('/folders/hypervisors', body).then((r) => r.data),
}

// ─── User API ─────────────────────────────────────────────────────────────────
export const userApi = {
  list:            () => api.get('/users').then((r) => r.data),
  create:          (body: object) => api.post('/users', body).then((r) => r.data),
  update:          (id: string, body: object) => api.patch(`/users/${id}`, body).then((r) => r.data),
  delete:          (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
  groups:          () => api.get('/users/groups/all').then((r) => r.data),
  createGroup:     (body: object) => api.post('/users/groups', body).then((r) => r.data),
  addToGroup:      (uid: string, gid: string) => api.post(`/users/${uid}/groups/${gid}`).then((r) => r.data),
  assignPermission:(body: object) => api.post('/users/permissions', body).then((r) => r.data),
}

// ─── Server (Hypervisor) API ──────────────────────────────────────────────────
export const serverApi = {
  list:             (folderId?: string) => api.get('/servers', { params: folderId ? { folder_id: folderId } : {} }).then((r) => r.data),
  get:              (id: string) => api.get(`/servers/${id}`).then((r) => r.data),
  verifyCredentials:(body: { hostname: string; username: string; password: string }) =>
                      api.post('/servers/verify-credentials', body).then((r) => r.data),
  register:         (body: object) => api.post('/servers', body).then((r) => r.data),
  update:           (id: string, body: object) => api.patch(`/servers/${id}`, body).then((r) => r.data),
  toggleOnline:     (id: string) => api.post(`/servers/${id}/toggle-online`).then((r) => r.data),
  delete:           (id: string) => api.delete(`/servers/${id}`).then((r) => r.data),
  listDrives:       (id: string) =>
                      api.get(`/servers/${id}/drives`).then((r) => r.data),
  listISOs:         (id: string, path?: string) =>
                      api.get(`/servers/${id}/isos`, { params: path ? { path } : {} }).then((r) => r.data),
  uploadFile:       (id: string, destPath: string, file: File) => {
    const fd = new FormData(); fd.append('file', file)
    return api.post(`/servers/${id}/upload`, fd, {
      params: { dest_path: destPath },
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data)
  },
}

// ─── Auth extras ──────────────────────────────────────────────────────────────
export const authApi = {
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword }).then((r) => r.data),
}

// ─── Audit API ────────────────────────────────────────────────────────────────
export const auditApi = {
  list: (params?: object) => api.get('/audit', { params }).then((r) => r.data),
}
