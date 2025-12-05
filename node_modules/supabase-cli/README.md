# supabase-cli

## description

Create a cli environment for supabase.  
The Docker environment to be used for construction is obtained from the latest repository of supabase.

## usage

```
Usage: spabase-cli [options] [command]

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  init                Initialize supabase
  start               Launch supabase
  stop                Stop supabase
  restart             Restart supabase
  remove              Remove supabase
  update              Update supabase
  reset               Database initialization
  info                View access to supabase
  regions                     List of region
  backup <filename>   Backup database
  restore <filename>  Restore database
  user                [command]
    create <email> <password>  Create a user
    list                       Displaying the user list
  migration           [command]
    create [name]     Create migration
      -t, --tableName <tableName>  Output table name
    up                Apply migrations
  remote              [command]
    restore [options] <filename> Restore remote databases
      -a, --host <host>          Host address of database
      -p, --password <password>  Password for database
    backup [options] <filename>  Backup remote databases
      -a, --host <host>          Host address of database
      -p, --password <password>  Password for database
    migration [options]          Migration remote databases
      -a, --host <host>          Host address of database
      -p, --password <password>  Password for database
    reset [options]              Reset the remote
      -a, --host <host>          Host address of database
      -p, --password <password>  Password for database
    user                         [command]
      create <email> <password>            Create a remote user
        -u, --url <url>                    Url of supabase
        -k, --service_role <service_role>  Service role of supabase
      list [options]                       Display of remote user list
        -u, --url <url>                    Url of supabase
        -k, --service_role <service_role>  Service role of supabase
  project
      list [options]
        -t, --token <accessToken>  AccessToken
      create [options] name dbpass
        -t, --token <accessToken>  AccessToken
        -p, --plan <plan>          Plan of project
        -r, --region <region>      Region of project
        -o, --org <org>            Organization of project
  organization
      list [options]
        -t, --token <accessToken>  AccessToken
  help [command]  display help for command
```

Remote commands refer to the value of `supabase/.env.remote`

```env
url=https://xxxxx.supabase.co
service_role=xxxx
db_password=xxxx
access_token=xxxx
```

## For remote backup and remote reset

You will need superuser privileges, so run the following command from SQLEditor on the web.

```sql
alter role postgres with superuser;
```

Remote operation is an experimental feature.

## Regarding initialization

### command

```sh
supabase-cli init
```

For the second and subsequent runs, the file is updated.

### Operation

#### 1. Download files to the `supabase` directory

- https://github.com/supabase/supabase/tree/master/docker
  - `.gitignore` will not be overwritten
- https://github.com/supabase/storage-api/tree/master/migrations/tenant/
- https://github.com/supabase/realtime/tree/master/server/priv/repo/migrations

#### 2. Creation of `supabase/docker/.env`

- If the file already exists, it will not be overwritten

#### 3. Recalculate AccessKey based on JWT_SECRET

- supabase/docker/.env
- supabase/docker/volumes/api/kong.yml

Recalculation of AccessKey by JWT_SECRET is also done at start.

## Startup and shutdown

### Startup of supabase

```sh
supabase-cli start
```

### Stop supabase

```sh
supabase-cli stop
```

### Remove containers from Docker

```sh
supabase-cli remove
```

### important point

After applying the following migrations, realtime functions will no longer work.  
The current version has been modified to not include them in system-migrations.

- 20220603231003_add_quoted_regtypes_support.exs
- 20220603232444_add_output_for_data_less_than_equal_64_bytes_when_payload_too_large.exs
- 20220615214548_add_quoted_regtypes_backward_compatibility_support.exs
