/**
 * Custom Resource handler for S3 Files filesystem lifecycle.
 * Uses @aws-sdk/client-s3files to create/delete filesystems and mount targets.
 */
import {
  S3FilesClient,
  CreateFileSystemCommand,
  DeleteFileSystemCommand,
  CreateMountTargetCommand,
  DeleteMountTargetCommand,
  ListMountTargetsCommand,
  GetFileSystemCommand,
} from '@aws-sdk/client-s3files';

const client = new S3FilesClient({});

export async function handler(event) {
  const region = process.env.AWS_REGION;
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    if (event.RequestType === 'Create') {
      const { BucketArn, RoleArn, SubnetIds, SecurityGroupId } = event.ResourceProperties;

      // Create filesystem (SDK v3 uses camelCase parameters)
      const fsResult = await client.send(new CreateFileSystemCommand({
        bucket: BucketArn,
        roleArn: RoleArn,
      }));
      const fsId = fsResult.fileSystemId;
      console.log(`Created filesystem: ${fsId}`);

      // Wait for filesystem to become available (status != 'creating')
      for (let i = 0; i < 30; i++) {
        const fs = await client.send(new GetFileSystemCommand({ fileSystemId: fsId }));
        console.log(`Filesystem status: ${fs.status} (attempt ${i + 1})`);
        if (fs.status === 'available') break;
        if (fs.status === 'error') throw new Error(`Filesystem creation failed: ${fs.statusMessage}`);
        await new Promise(r => setTimeout(r, 10000)); // 10s between checks
      }

      // Create mount targets in each subnet
      for (const subnetId of SubnetIds.split(',')) {
        try {
          const mtResult = await client.send(new CreateMountTargetCommand({
            fileSystemId: fsId,
            subnetId: subnetId,
            securityGroups: [SecurityGroupId],
          }));
          console.log(`Created mount target ${mtResult.mountTargetId} in ${subnetId}`);
        } catch (e) {
          console.log(`Mount target error in ${subnetId} (may already exist):`, e.message);
        }
      }

      return {
        PhysicalResourceId: fsId,
        Data: { FileSystemId: fsId },  // PascalCase for CloudFormation getAtt
      };
    }

    if (event.RequestType === 'Delete') {
      const fsId = event.PhysicalResourceId;
      if (!fsId || fsId === 'CREATE_FAILED') {
        console.log('No filesystem to delete');
        return { PhysicalResourceId: fsId || 'NONE' };
      }

      try {
        // List and delete mount targets first
        const mtResult = await client.send(new ListMountTargetsCommand({
          fileSystemId: fsId,
        }));
        for (const mt of (mtResult.mountTargets || [])) {
          console.log(`Deleting mount target ${mt.mountTargetId}`);
          await client.send(new DeleteMountTargetCommand({
            mountTargetId: mt.mountTargetId,
          }));
        }

        // Wait for mount targets to be deleted
        if (mtResult.mountTargets?.length > 0) {
          console.log('Waiting 60s for mount targets to be deleted...');
          await new Promise(r => setTimeout(r, 60000));
        }

        console.log(`Deleting filesystem ${fsId}`);
        await client.send(new DeleteFileSystemCommand({
          fileSystemId: fsId,
        }));
      } catch (e) {
        console.log('Delete error (may already be deleted):', e.message);
      }

      return { PhysicalResourceId: fsId };
    }

    // Update — no-op
    return { PhysicalResourceId: event.PhysicalResourceId };
  } catch (err) {
    console.error('Handler error:', err);
    throw err;
  }
}
