/**
 * A container image created these with mkdir -p, so they are part of the
 * writable layer and nothing survives a rebuild.
 */
export const IMAGE_ONLY_MOUNTINFO = [
  '21 27 0:20 / /proc rw,nosuid,nodev,noexec,relatime shared:12 - proc proc rw',
  '22 27 0:21 / /sys rw,nosuid,nodev,noexec,relatime shared:13 - sysfs sysfs rw',
  '23 27 0:22 / /dev rw,nosuid - tmpfs tmpfs rw,size=65536k,mode=755,inode64',
  '30 27 8:1 / / rw,relatime - overlay overlay rw,lowerdir=/var/lib/docker/x',
].join('\n')

/** What Dokku produces once the two documented storage mounts are in place. */
export const WITH_STDOKKU_MOUNTS_MOUNTINFO = [
  '21 27 0:20 / /proc rw,nosuid,nodev,noexec,relatime shared:12 - proc proc rw',
  '22 27 0:21 / /sys rw,nosuid,nodev,noexec,relatime shared:13 - sysfs sysfs rw',
  '30 27 8:1 / / rw,relatime - overlay overlay rw,lowerdir=/var/lib/docker/x',
  '253 27 0:61 /var/lib/dokku/data/storage/ocm-data /app/data rw,relatime - ext4 /dev/sda1 rw',
  '254 27 0:62 /var/lib/dokku/data/storage/ocm-workspace /workspace rw,relatime - ext4 /dev/sda1 rw',
].join('\n')
